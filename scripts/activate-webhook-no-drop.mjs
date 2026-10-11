// One-time, no-drop Telegram webhook switch after the replacement server is healthy.
// This script must be executed manually at cutover; it never runs at build/startup.
const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'PUBLIC_BASE_URL'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error('Missing ENV: ' + missing.join(', '));
const base = new URL(process.env.PUBLIC_BASE_URL);
if (base.protocol !== 'https:') throw new Error('PUBLIC_BASE_URL must be HTTPS');
const target = base.href.replace(/\/$/, '') + '/api/telegram';
const response = await fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/setWebhook', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: target,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'edited_message', 'callback_query'],
    drop_pending_updates: false,
  }),
  signal: AbortSignal.timeout(20000),
});
const result = await response.json();
if (!response.ok || !result?.ok) throw new Error('Telegram webhook activation failed: ' + (result?.description || response.status));
console.log('[mediax] Telegram webhook activated without dropping pending updates:', target);
