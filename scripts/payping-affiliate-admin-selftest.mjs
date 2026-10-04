import { readFile } from 'node:fs/promises';

const [api, page, detailPage, store, server, router, vercel, affiliatePage] = await Promise.all([
  readFile('handlers/affiliate-admin.js', 'utf8'),
  readFile('handlers/affiliate-admin-pwa.js', 'utf8'),
  readFile('handlers/affiliate-admin-detail-pwa.js', 'utf8'),
  readFile('src/affiliate/store.js', 'utf8'),
  readFile('server.js', 'utf8'),
  readFile('api/router.js', 'utf8'),
  readFile('vercel.json', 'utf8'),
  readFile('handlers/affiliate-pwa.js', 'utf8'),
]);

const must=(src,marker,label)=>{if(!src.includes(marker))throw new Error(`${label} missing: ${marker}`)};

must(api,'resolvePushDeviceOwner','owner device auth');
must(api,'BOT_OWNER_ID','owner id guard');
must(api,"action === 'finalize_withdrawal'",'admin finalize action');
must(api,"['PAID', 'REJECTED']",'payout decisions');
must(api,'markAffiliateWithdrawal','shared payout ledger');
must(api,'sendMessage','affiliate payout notification');
must(store,'export async function getAffiliateAdminDashboard','admin dashboard store');
must(store,'pendingWithdrawalAmount','admin payout summary');
must(store,'export async function getAffiliateAdminDetail','affiliate admin detail store');
must(store,'auditAffiliateWithdrawalWithExecutor','atomic payout reconciliation');
must(store,"reason: 'audit_mismatch'",'paid payout audit lock');
must(store,'grossMatchesOrder','audit gross amount check');
must(store,'commissionMath','audit commission math check');
must(store,'referralOwner','audit referral ownership check');
must(store,'payingReferrals','per-affiliate paying referral metric');
must(store,'affiliate_withdrawals','withdrawal query');
must(page,"fetch('/api/affiliate-admin'",'admin page API');
must(page,'Affiliates','compact affiliate list');
must(page,'Payout requests','compact payout list');
must(page,"/ar-payment/affiliate/admin/detail?affiliate=",'admin list-detail navigation');
must(detailPage,'Verified ✓','payout audit verified UI');
must(detailPage,'Payments checked','payout audit payment count');
must(detailPage,'Referrals','affiliate referral drilldown');
must(detailPage,'Payout history','affiliate payout history');
must(detailPage,'Mark Paid','admin paid action');
must(detailPage,'Reject','admin reject action');
must(page,"localStorage.getItem(key)",'admin device session');
must(affiliatePage,"probeAdmin()", 'owner-only admin link probe');
must(server,"['/api/affiliate-admin', affiliateAdminHandler]",'Node admin API route');
must(server,"['/ar-payment/affiliate/admin', affiliateAdminPageHandler]",'Node admin page route');
must(server,"['/ar-payment/affiliate/admin/detail', affiliateAdminDetailPageHandler]",'Node admin detail route');
must(router,"['affiliate-admin', affiliateAdminHandler]",'Vercel admin API route');
must(router,"['affiliate-admin-page', affiliateAdminPageHandler]",'Vercel admin page route');
must(router,"['affiliate-admin-detail-page', affiliateAdminDetailPageHandler]",'Vercel admin detail route');

const cfg=JSON.parse(vercel);
for(const source of ['/api/affiliate-admin','/ar-payment/affiliate/admin','/ar-payment/affiliate/admin/','/ar-payment/affiliate/admin/detail','/ar-payment/affiliate/admin/detail/']){
  if(!cfg.rewrites.some(x=>x.source===source))throw new Error(`Vercel rewrite missing: ${source}`);
}

if(/body\.ownerId|query\.ownerId|body\.userId/.test(api)){
  throw new Error('Affiliate admin API must not trust client supplied owner/user identity.');
}

console.log('PAYPING_AFFILIATE_ADMIN_SELFTEST_OK');
