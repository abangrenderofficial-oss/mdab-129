import { getContentBridgeGroup } from '../src/support/content-bridge.js';
import { currentSupportEnvironment, getSupportDb } from '../src/support/store.js';

function json(res, status, body) {
  return res.status(status).json(body);
}

function authorized(req) {
  const expected = String(process.env.CONTENT_BRIDGE_SECRET || '').trim();
  if (!expected) return false;
  return String(req.headers['x-content-bridge-secret'] || '') === expected;
}

function clean(value) {
  return String(value || '').trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, approved: false, error: 'method_not_allowed' });
  }
  if (!authorized(req)) {
    return json(res, 403, { ok: false, approved: false, error: 'invalid_bridge_secret' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const moderationId = Number(body.moderation_id || 0);
  const filterChatId = clean(body.filter_chat_id);
  const kind = clean(body.kind).toUpperCase();
  const contentBody = clean(body.body);
  const displayName = clean(body.display_name);
  const tierLabel = clean(body.tier_label);

  if (!Number.isSafeInteger(moderationId) || moderationId <= 0) {
    return json(res, 422, { ok: false, approved: false, error: 'invalid_moderation_id' });
  }
  if (!['SUPPORT', 'LUAHRASA'].includes(kind)) {
    return json(res, 422, { ok: false, approved: false, error: 'invalid_kind' });
  }

  try {
    const connected = await getContentBridgeGroup();
    if (!connected?.groupId || String(connected.groupId) !== filterChatId) {
      return json(res, 200, { ok: true, approved: false, error: 'filter_group_not_connected' });
    }

    const db = await getSupportDb();
    const environment = currentSupportEnvironment();
    const result = await db.execute({
      sql: `SELECT m.id, m.kind, m.body, m.display_name, m.tier_label,
                   m.status, m.filter_chat_id, d.status AS delivery_status,
                   d.channel_message_id
            FROM support_quote_moderation m
            LEFT JOIN support_quote_content_delivery d
              ON d.environment = m.environment AND d.moderation_id = m.id
            WHERE m.environment = ? AND m.id = ?
            LIMIT 1`,
      args: [environment, moderationId],
    });
    const row = result.rows?.[0];
    if (!row || String(row.status || '') !== 'APPROVED') {
      return json(res, 200, { ok: true, approved: false, error: 'not_approved' });
    }
    if (String(row.delivery_status || '') !== 'SENDING' || row.channel_message_id) {
      return json(res, 200, { ok: true, approved: false, error: 'delivery_not_claimed' });
    }

    const matches = String(row.filter_chat_id || '') === filterChatId
      && clean(row.kind).toUpperCase() === kind
      && clean(row.body) === contentBody
      && clean(row.display_name) === displayName
      && clean(row.tier_label) === tierLabel;

    return json(res, 200, {
      ok: true,
      approved: Boolean(matches),
      ...(matches ? {} : { error: 'payload_mismatch' }),
    });
  } catch (error) {
    console.error('[content-bridge/verify] failed:', error?.message);
    return json(res, 500, { ok: false, approved: false, error: 'verification_failed' });
  }
}
