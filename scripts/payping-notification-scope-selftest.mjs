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
must(push,'UNSUCCESSFUL_PAYMENT_STATUSES','terminal unsuccessful status guard');
must(push,"reason: 'non_terminal_payment_status'",'pending payment push suppression');
must(push,'!UNSUCCESSFUL_PAYMENT_STATUSES.has(status)','pending status must not emit unsuccessful push');
must(push,'payload.actionable = false','notification cannot send follow-up');
mustNot(push,"{ action: 'follow_up'","no push send buttons");
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
must(data,"actorRole:'owner'",'admin-only follow-up API');
must(data,"if(!auth.owner)return json(res,403",'affiliate cannot submit follow-ups');
must(detail,"if(!d?.owner||!f)",'no affiliate follow-up button');
must(sw,"orderNumber: String(data.orderNumber || '')",'push order context');
must(sw,"options.actions = data.actions.slice(0, maxActions)",'notification action rendering');
must(sw,"action === 'follow_up'",'follow-up notification action handler');
must(sw,"action === 'dont_follow_up'",'dismiss notification action handler');
mustNot(sw,"method: 'POST'",'service worker never initiates a manual follow-up');
must(sw,'event.waitUntil(openPayPingTarget(target))','notification opens Transaction Detail');
mustNot(sw,"self.registration.showNotification('Done!'","service worker cannot report follow-up success");
mustNot(sw,"body: 'Bot sudah follow up 🎉'",'success copy only after admin action in detail page');
must(sw,"client.navigate(target)",'notification click navigation');

console.log('PAYPING_NOTIFICATION_SCOPE_SELFTEST_OK');
