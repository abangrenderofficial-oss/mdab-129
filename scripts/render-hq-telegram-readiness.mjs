// Read-only GitHub Actions bot credential check. Never sends messages, edits
// webhook, fetches updates, writes stats, or prints tokens/Telegram user IDs.
const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const apiId = String(process.env.TELEGRAM_API_ID || '').trim();
const apiHash = String(process.env.TELEGRAM_API_HASH || '').trim();
if (!token || !apiId || !apiHash) {
  console.error('MEDIAX_WORKER_TELEGRAM_READINESS',JSON.stringify({
    ok:false,reason:'missing_worker_secrets',
    tokenPresent:Boolean(token),apiIdPresent:Boolean(apiId),apiHashPresent:Boolean(apiHash),
  }));
  process.exitCode=1;
} else {
  try {
    async function readOnly(method) {
      const r=await fetch('https://api.telegram.org/bot'+token+'/'+method,{
        method:'POST',signal:AbortSignal.timeout(12000),
      });
      const response=await r.json();
      if (!r.ok || !response?.ok) {
        throw Object.assign(new Error('Telegram read-only call failed'),{code:'telegram_read_failed',status:r.status});
      }
      return response.result;
    }
    const me=await readOnly('getMe');
    if (!me?.is_bot) throw new Error('telegram_token_not_bot');
    const hook=await readOnly('getWebhookInfo');
    const host=hook?.url ? new URL(hook.url).hostname : '';
    const railwayActive=host.endsWith('.railway.app');
    const renderActive=host.endsWith('.onrender.com');
    console.log('MEDIAX_WORKER_TELEGRAM_READINESS',JSON.stringify({
      ok:true,botVerified:true,mtprotoCredentialsPresent:true,
      telegramWebhookConfigured:Boolean(host),
      webhookAtRailway:railwayActive,webhookAtRender:renderActive,
      // No webhook destination URL or token is exposed.
    }));
    if (renderActive) {
      console.error('WARNING: Render webhook detected; verify authorized cutover');
    }
  } catch(e) {
    console.error('MEDIAX_WORKER_TELEGRAM_READINESS',JSON.stringify({
      ok:false,reason:String(e.code||e.name||'read_only_call_failed').slice(0,60),
    }));
    process.exitCode=1;
  }
}
