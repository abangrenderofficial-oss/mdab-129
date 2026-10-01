import { isResetAdmin } from '../recovery.js';
import {
  deleteChannelMessageForSafety,
  getTelegramChat,
  sendMessage,
} from '../telegram.js';
import {
  listQuoteFilterLeakMessages,
  listResettableChannelMessages,
  markChannelPolicyDeleted,
} from '../bot/channel-policy.js';

function configuredChannelTargets() {
  const values = [
    process.env.REQUIRED_CHANNEL_USERNAME || '@ar_downloaderbot',
    process.env.SUPPORT_CHANNEL_CHAT_ID || '',
    process.env.SUPPORT_CHANNEL_USERNAME || '',
  ];
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

async function resolveOfficialChannels() {
  const found = new Map();
  for (const target of configuredChannelTargets()) {
    try {
      const chat = await getTelegramChat(target);
      if (chat?.type !== 'channel' || !chat?.id) continue;
      found.set(String(chat.id), chat);
    } catch (error) {
      console.warn('[resetchannel] target lookup failed:', target, error?.message);
    }
  }
  return [...found.values()];
}

function messageKey(chatId, messageId) {
  return `${String(chatId)}:${String(messageId)}`;
}

export async function handleResetChannelCommand(message = {}) {
  const chatId = message?.chat?.id;
  const chatType = message?.chat?.type;
  const userId = message?.from?.id;

  if (!isResetAdmin(userId)) {
    await sendMessage(chatId, '❌ /resetchannel hanya untuk admin bot.').catch(() => {});
    return true;
  }
  if (chatType !== 'private') {
    await sendMessage(chatId, '❌ /resetchannel hanya boleh dibuat dalam private chat bot.').catch(() => {});
    return true;
  }

  const channels = await resolveOfficialChannels();
  if (!channels.length) {
    await sendMessage(
      chatId,
      '❌ Channel rasmi tak dapat disahkan sekarang. Tiada delete dibuat untuk elak tersalah padam.',
    ).catch(() => {});
    return true;
  }

  const channelIds = channels.map((chat) => String(chat.id));
  const [ledgerRows, quoteRows] = await Promise.all([
    listResettableChannelMessages(channelIds).catch(() => []),
    listQuoteFilterLeakMessages(channelIds).catch(() => []),
  ]);

  const candidates = new Map();
  for (const row of ledgerRows) {
    if (!row?.chatId || !row?.messageId) continue;
    candidates.set(messageKey(row.chatId, row.messageId), {
      chatId: row.chatId,
      messageId: row.messageId,
      ledgerIds: [row.id],
      source: 'policy-ledger',
    });
  }
  for (const row of quoteRows) {
    if (!row?.chatId || !row?.messageId) continue;
    const key = messageKey(row.chatId, row.messageId);
    const current = candidates.get(key);
    if (current) {
      current.source = `${current.source}+quote-filter`;
    } else {
      candidates.set(key, {
        chatId: row.chatId,
        messageId: row.messageId,
        ledgerIds: [],
        source: `quote-filter:${row.kind || 'unknown'}`,
      });
    }
  }

  let deleted = 0;
  let failed = 0;
  for (const candidate of candidates.values()) {
    try {
      await deleteChannelMessageForSafety(candidate.chatId, candidate.messageId);
      deleted += 1;
      for (const ledgerId of candidate.ledgerIds) {
        await markChannelPolicyDeleted(ledgerId).catch(() => {});
      }
    } catch (error) {
      failed += 1;
      console.warn('[resetchannel] delete failed:', {
        chatId: candidate.chatId,
        messageId: candidate.messageId,
        source: candidate.source,
        code: error?.code,
        message: error?.message,
      });
    }
  }

  await sendMessage(
    chatId,
    [
      '🛡️ Channel Reset selesai.',
      '',
      `Channel diperiksa: ${channels.length}`,
      `Leak ber-ID yang dijumpai: ${candidates.size}`,
      `Berjaya delete: ${deleted}`,
      `Gagal/Telegram tak benarkan delete: ${failed}`,
      '',
      'Support promotion Downloader Bot tidak disentuh.',
      'Channel firewall kekal aktif: Downloader Bot tak dibenarkan post quote, luahan atau video pantauan ke mana-mana channel.',
    ].join('\n'),
  ).catch(() => {});
  return true;
}
