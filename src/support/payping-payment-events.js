// PayPing owns the payment gateway (CHIP / Bayarcash). When it has verified a MediaX payment
// it writes one "paid" event to the shared database. MediaX picks it up here and runs the exact
// same bookkeeping and messages as a verified Bayarcash callback: order PAID, support totals,
// legacy affiliate commission, the user's "Support diterima" message, monitor and owner pushes.
// MediaX never talks to the gateway on this path.
import { currentSupportEnvironment, getSupportDb, applyBayarcashTransaction } from './store.js';
import { afterSupportTransaction } from './after-payment.js';

const MAX_ATTEMPTS = 8;
let timer = null;
let running = false;

async function tableReady(db) {
  try {
    await db.execute("SELECT 1 FROM payping_payment_events_v1 LIMIT 1");
    return true;
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ''))) return false;
    throw error;
  }
}

/** One pass. Returns how many events were applied. Safe to run often and from several instances. */
export async function consumePayPingPaymentEvents({ limit = 10 } = {}) {
  if (running) return { skipped: 'running' };
  running = true;
  let applied = 0;
  try {
    const db = await getSupportDb();
    if (!await tableReady(db)) return { applied: 0, table: false };
    const env = currentSupportEnvironment();
    const due = await db.execute({
      sql: "SELECT event_id, order_number, gateway, external_id, amount_cents, attempts FROM payping_payment_events_v1 WHERE environment = ? AND bot_id = 'mediax' AND status = 'paid' AND consumed_at = '' AND attempts < ? ORDER BY created_at LIMIT ?",
      args: [env, MAX_ATTEMPTS, limit],
    });
    for (const event of due.rows || []) {
      const stamp = new Date().toISOString();
      // Claim it first so two instances never apply the same payment.
      const claim = await db.execute({
        sql: "UPDATE payping_payment_events_v1 SET consumed_at = ?, attempts = attempts + 1 WHERE environment = ? AND event_id = ? AND consumed_at = ''",
        args: ['processing:' + stamp, env, event.event_id],
      });
      if (Number(claim.rowsAffected || 0) !== 1) continue;
      try {
        const payload = {
          order_number: String(event.order_number),
          transaction_id: `${String(event.gateway || 'payping')}:${String(event.external_id || event.order_number)}`.slice(0, 120),
          status: '3', // Bayarcash "successful": same verified-paid path
          amount: (Number(event.amount_cents) / 100).toFixed(2),
          status_description: `Paid via PayPing (${String(event.gateway || '').toUpperCase()})`,
        };
        const result = await applyBayarcashTransaction(payload);
        if (!result?.knownOrder) throw new Error('Order not found in MediaX tables');
        if (result?.amountMismatch) throw new Error('Amount does not match order');
        await afterSupportTransaction(result, { sandbox: false, enforcePaidSubmission: true });
        await db.execute({
          sql: "UPDATE payping_payment_events_v1 SET consumed_at = ?, last_error = '' WHERE environment = ? AND event_id = ?",
          args: [new Date().toISOString(), env, event.event_id],
        });
        applied += 1;
        console.log('[payping-events] payment applied', { order_number: event.order_number, gateway: event.gateway, became_paid: Boolean(result?.becamePaid) });
      } catch (error) {
        // Release it for a retry (bounded by MAX_ATTEMPTS); PayPing alerts the owner if it stays stuck.
        await db.execute({
          sql: "UPDATE payping_payment_events_v1 SET consumed_at = '', last_error = ? WHERE environment = ? AND event_id = ?",
          args: [String(error?.message || 'failed').slice(0, 200), env, event.event_id],
        }).catch(() => {});
        console.warn('[payping-events] payment not applied yet:', event.order_number, error?.message);
      }
    }
    return { applied };
  } finally {
    running = false;
  }
}

export function startPayPingPaymentEvents(intervalMs = 10_000) {
  if (timer) return;
  const run = () => void consumePayPingPaymentEvents().catch((error) => console.warn('[payping-events] poll failed:', error?.message));
  run();
  timer = setInterval(run, intervalMs);
  timer.unref?.();
}
