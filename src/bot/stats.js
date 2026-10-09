import { createStatsPersistence } from './stats-persistence.js';
import { sendMessage, telegram } from '../telegram.js';

const EVENT_TYPES = new Set(['download', 'status_hq', 'live_wallpaper']);
const STATS_FILE = String(process.env.STATS_FILE_PATH || '/data/bot-stats.json');
const STATS_VERSION = 2;
const CHANNEL_GATE_COUNTER_VERSION = 3;
export const CHANNEL_GATE_THRESHOLD = 5;
export const PREMIUM_HQ_CHANNEL_GATE_THRESHOLD = CHANNEL_GATE_THRESHOLD;

let statePromise = null;
let writeQueue = Promise.resolve();

function emptyState() {
  return {
    version: STATS_VERSION,
    trackingSince: new Date().toISOString(),
    users: {},
    monthlyDownloads: {},
  };
}

function normalizeState(raw) {
  const fallback = emptyState();
  if (!raw || typeof raw !== 'object') return fallback;
  return {
    version: STATS_VERSION,
    trackingSince: typeof raw.trackingSince === 'string' && raw.trackingSince
      ? raw.trackingSince
      : fallback.trackingSince,
    users: raw.users && typeof raw.users === 'object' ? raw.users : {},
    monthlyDownloads: raw.monthlyDownloads && typeof raw.monthlyDownloads === 'object'
      ? raw.monthlyDownloads
      : {},
  };
}

const statsPersistence = createStatsPersistence({ filePath: STATS_FILE });

async function loadState() {
  if (!statePromise) {
    statePromise = statsPersistence.load()
      .then((raw) => raw == null ? emptyState() : normalizeState(raw))
      .catch((error) => { statePromise = null; throw error; });
  }
  return statePromise;
}

async function persistState(state) {
  await statsPersistence.persist(state);
}

function mutate(mutator) {
  const pending = writeQueue.catch(() => {}).then(async () => {
    const state = await loadState();
    mutator(state);
    try {
      await persistState(state);
    } catch (error) {
      statePromise = null;
      throw error;
    }
  });
  writeQueue = pending.catch((error) => {
    console.error('[stats] write failed:', error?.message);
    if (statsPersistence.backend === 'turso') throw error;
  });
  return writeQueue;
}

function validUserKey(userId) {
  const id = Number(userId || 0);
  if (!Number.isSafeInteger(id) || id <= 0) return '';
  return String(id);
}

function monthKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function legacyPremiumHqCount(old = {}) {
  const stored = Number(old?.premiumHqCompletedCount);
  if (Number.isSafeInteger(stored) && stored >= 0) return stored;
  return old?.premiumHqCompleted ? 1 : 0;
}

function hasCurrentChannelCounter(old = {}) {
  return Number(old?.channelGateCounterVersion || 0) === CHANNEL_GATE_COUNTER_VERSION;
}

function currentChannelUseCount(old = {}) {
  if (!hasCurrentChannelCounter(old)) return 0;
  const stored = Number(old?.channelUseCount);
  return Number.isSafeInteger(stored) && stored >= 0 ? stored : 0;
}

function touchUser(state, userId, now = new Date()) {
  const key = validUserKey(userId);
  if (!key) return null;
  const iso = now.toISOString();
  const old = state.users[key] && typeof state.users[key] === 'object' ? state.users[key] : {};
  const premiumHqCompletedCount = legacyPremiumHqCount(old);
  const counterWasCurrent = hasCurrentChannelCounter(old);
  const channelUseCount = currentChannelUseCount(old);
  const user = {
    firstSeen: old.firstSeen || iso,
    lastSeen: iso,
    statusHq: Boolean(old.statusHq),
    liveWallpaper: Boolean(old.liveWallpaper),
    completedUse: Boolean(old.completedUse || old.statusHq || old.liveWallpaper),
    channelGateCounterVersion: CHANNEL_GATE_COUNTER_VERSION,
    channelUseCount,
    premiumHqCompletedCount,
    premiumHqCompleted: premiumHqCompletedCount >= PREMIUM_HQ_CHANNEL_GATE_THRESHOLD,
    premiumHqCompletionKeys: Array.isArray(old.premiumHqCompletionKeys)
      ? old.premiumHqCompletionKeys.filter((value) => typeof value === 'string' && value).slice(-100)
      : [],
    joinPromptSent: counterWasCurrent ? Boolean(old.joinPromptSent) : false,
  };
  state.users[key] = user;
  return user;
}

export async function recordUsage(userId, eventType = null) {
  const key = validUserKey(userId);
  if (!key) return false;
  if (eventType && !EVENT_TYPES.has(eventType)) return false;

  await mutate((state) => {
    const now = new Date();
    const user = touchUser(state, userId, now);
    if (!user) return;

    if (eventType) {
      user.completedUse = true;
    }

    if (eventType === 'download') {
      const month = monthKey(now);
      state.monthlyDownloads[month] = Math.max(0, Number(state.monthlyDownloads[month] || 0)) + 1;
    } else if (eventType === 'status_hq') {
      user.statusHq = true;
    } else if (eventType === 'live_wallpaper') {
      user.liveWallpaper = true;
    }
  });
  return true;
}

export async function hasCompletedUse(userId) {
  const key = validUserKey(userId);
  if (!key) return false;
  await writeQueue;
  const state = await loadState();
  const user = state.users?.[key];
  return Boolean(user?.completedUse || user?.statusHq || user?.liveWallpaper);
}

export async function getChannelUseCount(userId) {
  const key = validUserKey(userId);
  if (!key) return 0;
  await writeQueue;
  const state = await loadState();
  return currentChannelUseCount(state.users?.[key] || {});
}

export async function hasChannelGateRequired(userId) {
  return (await getChannelUseCount(userId)) >= CHANNEL_GATE_THRESHOLD;
}

export async function markPremiumHqCompleted(userId, completionKey = '') {
  const key = validUserKey(userId);
  if (!key) return false;

  const normalizedCompletionKey = String(completionKey || '').trim().slice(0, 240);
  let counted = false;

  await mutate((state) => {
    const user = touchUser(state, userId, new Date());
    if (!user) return;

    const currentCount = Math.max(0, Number(user.channelUseCount || 0));

    // New callers supply a stable key for each successful Premium+ HQ delivery.
    // Retries of the same completion key are ignored, so webhook retries cannot
    // make a user reach the channel gate early.
    if (normalizedCompletionKey) {
      const keys = Array.isArray(user.premiumHqCompletionKeys)
        ? user.premiumHqCompletionKeys
        : [];
      if (keys.includes(normalizedCompletionKey)) return;

      keys.push(normalizedCompletionKey);
      user.premiumHqCompletionKeys = keys.slice(-100);
      user.channelUseCount = currentCount + 1;
      counted = true;
    } else {
      // Backward-compatible fallback for legacy completion calls: retain the
      // old idempotent behaviour instead of incrementing repeatedly.
      user.channelUseCount = Math.max(1, currentCount);
      counted = currentCount < 1;
    }

    if (counted) {
      user.premiumHqCompletedCount = Math.max(0, Number(user.premiumHqCompletedCount || 0)) + 1;
    }
    user.premiumHqCompleted = user.channelUseCount >= PREMIUM_HQ_CHANNEL_GATE_THRESHOLD;
  });

  return counted;
}

export async function getPremiumHqCompletedCount(userId) {
  const key = validUserKey(userId);
  if (!key) return 0;
  await writeQueue;
  const state = await loadState();
  return legacyPremiumHqCount(state.users?.[key] || {});
}

export async function hasPremiumHqCompleted(userId) {
  return (await getPremiumHqCompletedCount(userId)) >= PREMIUM_HQ_CHANNEL_GATE_THRESHOLD;
}

export async function hasJoinPromptBeenSent(userId) {
  const key = validUserKey(userId);
  if (!key) return false;
  await writeQueue;
  const state = await loadState();
  const user = state.users?.[key] || {};
  if (!hasCurrentChannelCounter(user)) return false;
  return Boolean(user.joinPromptSent);
}

export async function markJoinPromptSent(userId) {
  const key = validUserKey(userId);
  if (!key) return false;
  await mutate((state) => {
    const user = touchUser(state, userId, new Date());
    if (user) user.joinPromptSent = true;
  });
  return true;
}

export async function getUsageStats() {
  await writeQueue;
  const state = await loadState();
  const users = Object.values(state.users || {});
  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);

  return {
    totalUsers: users.length,
    active30Days: users.filter((user) => {
      const lastSeen = Date.parse(String(user?.lastSeen || ''));
      return Number.isFinite(lastSeen) && lastSeen >= cutoff;
    }).length,
    downloadsThisMonth: Math.max(0, Number(state.monthlyDownloads?.[monthKey()] || 0)),
    statusHqUsers: users.filter((user) => Boolean(user?.statusHq)).length,
    liveWallpaperUsers: users.filter((user) => Boolean(user?.liveWallpaper)).length,
    trackingSince: state.trackingSince,
  };
}

function number(value) {
  return new Intl.NumberFormat('en-MY').format(Number(value || 0));
}

async function isGroupAdmin(chatId, userId) {
  if (!chatId || !userId) return false;
  const ownerId = String(process.env.BOT_OWNER_ID || '').trim();
  if (ownerId && String(userId) === ownerId) return true;
  try {
    const member = await telegram('getChatMember', { chat_id: chatId, user_id: userId });
    return member?.status === 'creator' || member?.status === 'administrator';
  } catch {
    return false;
  }
}

export async function handleTotalUserCommand(message, context = {}) {
  const chatId = message?.chat?.id;
  const chatType = message?.chat?.type;
  const userId = message?.from?.id;
  if (!chatId) return;

  if (!['group', 'supergroup'].includes(chatType)) {
    await sendMessage(chatId, '❌ /totaluser hanya boleh digunakan dalam group pemantauan.');
    return;
  }

  if (context.mirrorGroupId && String(context.mirrorGroupId) !== String(chatId)) {
    await sendMessage(chatId, '❌ /totaluser hanya aktif dalam group pemantauan yang sedang connected.');
    return;
  }

  if (String(process.env.BOT_OWNER_ID || '').trim() !== String(userId || '')) {
    await sendMessage(chatId, '❌ Hanya owner bot boleh guna /totaluser.');
    return;
  }

  try {
    const stats = await getUsageStats();
    await sendMessage(chatId, [
      '📊 Bot Statistics',
      '',
      `Total users: ${number(stats.totalUsers)}`,
      `Active last 30 days: ${number(stats.active30Days)}`,
      `Downloads this month: ${number(stats.downloadsThisMonth)}`,
      `Status HQ users: ${number(stats.statusHqUsers)}`,
      `Live Wallpaper users: ${number(stats.liveWallpaperUsers)}`,
    ].join('\n'));
  } catch (error) {
    console.error('[stats/totaluser] failed:', error?.message);
    await sendMessage(chatId, '❌ Statistik belum dapat dibaca sekarang. Cuba /totaluser sekali lagi nanti.');
  }
}
