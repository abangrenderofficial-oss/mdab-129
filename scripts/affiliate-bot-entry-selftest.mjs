import { readFile } from 'node:fs/promises';

const [feature, telegram, auth] = await Promise.all([
  readFile('src/features/affiliate.js', 'utf8'),
  readFile('handlers/telegram.js', 'utf8'),
  readFile('src/payping/auth.js', 'utf8'),
]);

function must(source, marker, label) {
  if (!source.includes(marker)) throw new Error('AFFILIATE_BOT_ENTRY_SELFTEST_FAILED: ' + label + ' missing ' + marker);
}
function mustNot(source, marker, label) {
  if (source.includes(marker)) throw new Error('AFFILIATE_BOT_ENTRY_SELFTEST_FAILED: ' + label + ' still contains ' + marker);
}

must(feature, "'🔗 Open PayPing Affiliate'", 'affiliate web button');
must(feature, "'Register / Login → Connect Telegram → Join Affiliate'", 'web onboarding flow');
must(feature, 'return sendAffiliateWebEntry(message, context);', 'affiliate command web entry');
must(feature, 'return sendAffiliateWebEntry(message, context, { withdraw: true });', 'withdraw web entry');
must(feature, 'Affiliate sekarang dibuka melalui PayPing.', 'legacy callback migration');
must(telegram, 'handleAffiliateCommand(message, context)', 'affiliate command context');
must(telegram, 'handleAffiliateWithdrawCommand(message, context)', 'withdraw command context');
must(telegram, 'processAffiliateCallback(callbackQuery, context)', 'affiliate callback context');
mustNot(auth, 'affiliateExists(telegramUserId)', 'register auto promotion');
mustNot(auth, 'affiliateExists(userId)', 'link auto promotion');
must(auth, 'promotePayPingAccountToAffiliate', 'explicit web join promotion');

console.log('AFFILIATE_BOT_ENTRY_SELFTEST_OK');
