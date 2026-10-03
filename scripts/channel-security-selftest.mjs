import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function text(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

async function jsFilesUnder(relativeDir) {
  const root = path.join(repoRoot, relativeDir);
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
    }
  }
  await walk(root);
  return files;
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
  text('handlers/telegram.js'),
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

const productionFiles = [
  ...(await jsFilesUnder('src')),
  ...(await jsFilesUnder('api')),
  ...(await jsFilesUnder('handlers')),
  path.join(repoRoot, 'server.js'),
];
for (const file of productionFiles) {
  const rel = path.relative(repoRoot, file).replaceAll('\\', '/');
  const source = await readFile(file, 'utf8');

  if (source.includes('sendSupportPromotionToChannel')
      && !['src/telegram.js', 'src/support/promotion.js'].includes(rel)) {
    throw new Error(`CHANNEL_SECURITY_CHECK_FAILED: support promotion channel capability imported outside promotion module: ${rel}`);
  }

  if (source.includes('deleteChannelMessageForSafety')
      && !['src/telegram.js', 'src/features/channel-reset.js'].includes(rel)) {
    throw new Error(`CHANNEL_SECURITY_CHECK_FAILED: channel safety-delete capability imported outside reset module: ${rel}`);
  }

  if (source.includes('api.telegram.org/bot') && rel !== 'src/telegram.js') {
    throw new Error(`CHANNEL_SECURITY_CHECK_FAILED: raw Telegram Bot API channel bypass path found: ${rel}`);
  }
}

console.log('Channel security check passed: downloader channel writes are support-promotion-only; monitoring and quote destinations are group-only; channel capabilities are exclusively owned.');
