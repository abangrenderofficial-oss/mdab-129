import { readFile } from 'node:fs/promises';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function requireContains(source, needle, label) {
  if (!source.includes(needle)) throw new Error(`CHANNEL_SECURITY_CHECK_FAILED: ${label}`);
}

function requireNotContains(source, needle, label) {
  if (source.includes(needle)) throw new Error(`CHANNEL_SECURITY_CHECK_FAILED: ${label}`);
}

const [
  telegram,
  promotion,
  community,
  audit,
  quoteFeature,
  quoteStore,
  webhook,
  commands,
  resetFeature,
  channelPolicy,
] = await Promise.all([
  text('src/telegram.js'),
  text('src/support/promotion.js'),
  text('src/support/community.js'),
  text('src/bot/audit.js'),
  text('src/features/quote-filter.js'),
  text('src/support/quote-filter.js'),
  text('api/telegram.js'),
  text('src/bot/commands.js'),
  text('src/features/channel-reset.js'),
  text('src/bot/channel-policy.js'),
]);

requireContains(telegram, 'DOWNLOADER_CHANNEL_WRITE_BLOCKED', 'generic channel firewall must exist');
requireContains(telegram, 'sendSupportPromotionToChannel', 'support promotion must have explicit channel capability');
requireContains(telegram, 'deleteChannelMessageForSafety', 'channel reset must have explicit delete capability');
requireContains(telegram, "purpose === CHANNEL_PROMOTION_PURPOSE && method === 'sendMessage'", 'promotion capability must be sendMessage-only');
requireContains(promotion, 'sendSupportPromotionToChannel', 'channel promotion must use protected capability');
requireNotContains(promotion, 'await sendMessage(channelUsername()', 'promotion must not bypass protected channel capability');
requireContains(community, 'DOWNLOADER_DIRECT_CHANNEL_DISABLED', 'legacy direct community publishing must stay disabled');
requireContains(audit, "['group', 'supergroup'].includes(chat?.type)", 'video monitoring destination must be group-only');
requireContains(audit, 'isResetAdmin(userId)', 'video monitoring connect must require bot admin');
requireContains(quoteFeature, 'isResetAdmin(userId)', 'quote filter connect must require bot admin');
requireContains(quoteStore, "['group', 'supergroup'].includes(chat?.type)", 'quote destination must be group-only');
requireContains(webhook, "command === '/menuadmin'", 'private admin menu command must exist');
requireContains(webhook, "command === '/resetchannel'", 'channel reset command must exist');
requireContains(webhook, "message?.chat?.type !== 'private'", 'admin-sensitive commands must enforce private chat');
requireContains(commands, '/resetchannel — Bersihkan leak Downloader Bot di channel', 'admin menu must list channel reset');
requireContains(resetFeature, 'deleteChannelMessageForSafety', 'channel reset must use protected delete capability');
requireContains(channelPolicy, "purpose <> 'SUPPORT_PROMOTION'", 'channel reset ledger must never select authorized support promotions');

console.log('Channel security check passed: downloader channel writes are support-promotion-only; monitoring and quote destinations are group-only.');
