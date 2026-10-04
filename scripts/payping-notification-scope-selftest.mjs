import { readFile } from 'node:fs/promises';

function must(source, needle, label) {
  if (!source.includes(needle)) throw new Error(`${label} missing ${needle}`);
}
function mustNot(source, needle, label) {
  if (source.includes(needle)) throw new Error(`${label} must not contain ${needle}`);
}

const [
  push,
  callback,
  supportReturn,
  supportFeature,
  dashboard,
  data,
  detail,
  sw,
] = await Promise.all([
  readFile('src/support/webpush-payment.js','utf8'),
  readFile('handlers/bayarcash.js','utf8'),
  readFile('handlers/support-return.js','utf8'),
  readFile('src/features/support.js','utf8'),
  readFile('src/payping/dashboard.js','utf8'),
  readFile('handlers/payping-data.js','utf8'),
  readFile('handlers/payping-transaction-detail-pwa.js','utf8'),
  readFile('handlers/payment-pwa.js','utf8'),
]);

must(push,'activeSubscriptionsForUsers','scoped push recipients');
mustNot(push,'async function activeSubscriptions()','global push broadcast');
must(push,"process.env.BOT_OWNER_ID",'owner push recipient');
must(push,'referred_by_user_id','affiliate referrer push recipient');
must(push,'record.telegram_user_id','payer push recipient');
must(push,'Payment Receive, ${tierName}','notification title');
mustNot(push,"'From PayPing!'",'duplicate notification brand line');
must(push,"successful 🎉' : 'unsuccessful 🥹'",'success and unsuccessful status');
must(push,'successful 🎉','successful spelling');
mustNot(push,'Successfull 🎉','success typo');
must(push,'/ar-payment/transaction?order=','transaction detail notification URL');
must(push,'deliveryKey = `order:${order}:','status-specific push dedupe');
must(push,"{ action: 'follow_up', title: 'Follow Up ✅' }",'follow-up notification action');
must(push,"{ action: 'dont_follow_up', title: 'Don’t Follow Up ❌' }",'dismiss notification action');
must(push,"String(target.ownerUserId || '') === ownerId",'owner actionable notification');
must(push,"String(target.ownerUserId || '') === referrerId",'affiliate actionable notification');
must(push,"COALESCE(r.telegram_username, '') AS referrer_username",'affiliate source username lookup');
must(push,"COALESCE(a.email, '') AS referrer_email",'affiliate source email fallback lookup');
must(push,"LEFT JOIN payping_accounts a",'affiliate account lookup');
must(push,"\\nvia ${sourceLine} 🫱🏻‍🫲🏼",'owner affiliate source notification line');
must(push,"affiliateSource: isOwnerRecipient ? affiliateSource : ''",'affiliate source visible to owner only');
must(push,"referrerEmail.split('@')[0]",'affiliate email local-part fallback');
must(push,"`@${referrerUsername}` : referrerEmailName",'affiliate username/email fallback');

must(callback,'unsuccessful callback notification failed','callback unsuccessful notification');
must(supportReturn,'return unsuccessful notification failed','return unsuccessful notification');
must(supportFeature,'intent failure notification failed','intent creation failure notification');

must(dashboard,"String(role || '').toLowerCase() === 'affiliate'",'affiliate transaction scope');
must(dashboard,'ap.referred_by_user_id = ?','affiliate referral ownership');
must(dashboard,"d.delivery_key LIKE ?",'transaction delivery history prefix');
must(data,"actorRole:auth.owner?'owner':'affiliate'",'affiliate follow-up API');
must(data,"PAYMENT_FOLLOWUP_COOLDOWN",'affiliate follow-up cooldown API');
must(detail,"String(d?.role||'').toLowerCase()==='affiliate'",'affiliate detail follow-up UI');
must(sw,"orderNumber: String(data.orderNumber || '')",'push order context');
must(sw,"options.actions = data.actions.slice(0, maxActions)",'notification action rendering');
must(sw,"action === 'follow_up'",'follow-up notification action handler');
must(sw,"action === 'dont_follow_up'",'dismiss notification action handler');
must(sw,"credentials: 'include'",'authenticated notification action');
must(sw,"action: 'payment_followup_send'",'notification follow-up API action');
must(sw,"self.registration.showNotification('Done!'",'follow-up done notification');
must(sw,"body: 'Bot sudah follow up 🎉'",'follow-up done copy');
must(sw,"client.navigate(target)",'notification click navigation');

console.log('PAYPING_NOTIFICATION_SCOPE_SELFTEST_OK');
