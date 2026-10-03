import { readFile } from 'node:fs/promises';

const [api, page, identity, store, server, router, vercel, affiliatePage] = await Promise.all([
  readFile('handlers/affiliate-admin.js', 'utf8'),
  readFile('handlers/affiliate-admin-pwa.js', 'utf8'),
  readFile('src/payping/identity.js', 'utf8'),
  readFile('src/affiliate/store.js', 'utf8'),
  readFile('server.js', 'utf8'),
  readFile('api/router.js', 'utf8'),
  readFile('vercel.json', 'utf8'),
  readFile('handlers/affiliate-pwa.js', 'utf8'),
]);

const must=(src,marker,label)=>{if(!src.includes(marker))throw new Error(`${label} missing: ${marker}`)};

must(api,'resolvePayPingIdentity','unified owner auth');
must(api,'identity.owner','owner role guard');
must(identity,'resolvePushDeviceOwner','legacy owner device fallback');
must(identity,'BOT_OWNER_ID','owner id guard');
must(api,"action === 'finalize_withdrawal'",'admin finalize action');
must(api,"['PAID', 'REJECTED']",'payout decisions');
must(api,'markAffiliateWithdrawal','shared payout ledger');
must(api,'sendMessage','affiliate payout notification');
must(store,'export async function getAffiliateAdminDashboard','admin dashboard store');
must(store,'pendingWithdrawalAmount','admin payout summary');
must(store,'affiliate_withdrawals','withdrawal query');
must(page,"fetch('/api/affiliate-admin'",'admin page API');
must(page,'Mark Paid','admin paid action');
must(page,'Reject','admin reject action');
must(page,"localStorage.getItem(key)",'admin account session');
must(page,"localStorage.getItem(legacyKey)",'admin legacy device fallback');
must(affiliatePage,"probeAdmin()", 'owner-only admin link probe');
must(server,"['/api/affiliate-admin', affiliateAdminHandler]",'Node admin API route');
must(server,"['/ar-payment/affiliate/admin', affiliateAdminPageHandler]",'Node admin page route');
must(router,"['affiliate-admin', affiliateAdminHandler]",'Vercel admin API route');
must(router,"['affiliate-admin-page', affiliateAdminPageHandler]",'Vercel admin page route');

const cfg=JSON.parse(vercel);
for(const source of ['/api/affiliate-admin','/ar-payment/affiliate/admin','/ar-payment/affiliate/admin/']){
  if(!cfg.rewrites.some(x=>x.source===source))throw new Error(`Vercel rewrite missing: ${source}`);
}

if(/body\.ownerId|query\.ownerId|body\.userId/.test(api)){
  throw new Error('Affiliate admin API must not trust client supplied owner/user identity.');
}

console.log('PAYPING_AFFILIATE_ADMIN_SELFTEST_OK');
