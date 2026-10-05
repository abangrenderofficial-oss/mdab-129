import { readFile } from 'node:fs/promises';

const home = await readFile('handlers/payping-home-pwa.js', 'utf8');

function must(marker, label) {
  if (!home.includes(marker)) throw new Error('PAYPING_OWNER_QUICK_ACTION_SELFTEST_FAILED: ' + label + ' missing ' + marker);
}

must('id="affiliateAdminQuick"', 'Affiliate Admin quick action');
must('href="/ar-payment/affiliate/admin"', 'Affiliate Admin target');
must("'affiliateAdminQuick').hidden=!d.owner", 'owner-only visibility');
must('id="analyticsQuick"', 'existing Analytics owner action preserved');
must('id="todayReceived"', 'Today Received dashboard preserved');
must('id="paidCount"', 'Paid count preserved');
must('id="pendingCount"', 'Pending count preserved');

console.log('PAYPING_OWNER_QUICK_ACTION_SELFTEST_OK');
