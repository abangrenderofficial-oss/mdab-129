import { readFile } from 'node:fs/promises';
import { currentSupportEnvironment, getSupportDb } from './store.js';
import { sendMessage, sendSupportPromotionToChannel, telegram } from '../telegram.js';
import { dailyForcePremiumChannelSupportText, supportCampaignText, supportMenuKeyboard } from '../features/support.js';
import { FRIDAY_SUPPORT_MODE_OFF, getFridaySupportMode } from './friday-access.js';
import {isPayPingSharedConfigEnabled} from './payping-shared-config.js';
import { startPaymentFollowupScheduler } from './payment-followup.js';
import {getActiveSupporterTitle} from './community-store.js';

const STATS_FILE = String(process.env.STATS_FILE_PATH || '/data/bot-stats.json');
const MALAYSIA_TIMEZONE = 'Asia/Kuala_Lumpur';
const CHECK_INTERVAL_MS = 60 * 1000;
const DEFAULT_PROMO_HOUR = 10;
const DEFAULT_CHANNEL_PROMO_HOUR = 13;
const DEFAULT_CHANNEL_PROMO_MINUTE = 20;
const PRIVATE_SEND_DELAY_MS = 55;

let schedulerTimer = null;
let cycleRunning = false;
let schemaPromise = null;
let cachedBotUsername = '';

function channelUsername() {
  const configured = String(process.env.REQUIRED_CHANNEL_USERNAME || '@ar_downloaderbot').trim();
  if (!configured) return '@ar_downloaderbot';
  if (configured.startsWith('@')) return configured;
  if (/^https?:\/\/t\.me\//i.test(configured)) {
    const slug = configured.replace(/^https?:\/\/t\.me\//i, '').split(/[/?#]/)[0];
    return slug ? `@${slug}` : '@ar_downloaderbot';
  }
  return `@${configured.replace(/^@/, '')}`;
}

// Prefer the verified channel configured for MediaX in PayPing. Never
// assume the bot username is a Telegram channel destination.
let lastMissingChannelWarning='';
async function promotionalChannelTarget(){
  const explicit=String(process.env.SUPPORT_PROMOTION_CHANNEL_USERNAME||process.env.REQUIRED_CHANNEL_USERNAME||'').trim();
  if(/^@[A-Za-z0-9_]{5,}$/.test(explicit))return explicit;
  if(isPayPingSharedConfigEnabled()){
    try{
      const client=await getSupportDb();
      const r=await client.execute({sql:"SELECT channel_id FROM payping_access_policies_v2 WHERE environment=? AND bot_id='mediax' LIMIT 1",args:[currentSupportEnvironment()]});
      const channel=String(r.rows?.[0]?.channel_id||'').trim();
      if(/^@[A-Za-z0-9_]{5,}$/.test(channel))return channel;
    }catch(error){console.warn('[support-promo] PayPing channel lookup failed:',error?.message)}
  }
  const old=channelUsername();
  // The old default may be the bot itself. It is unsafe to assume that it is
  // a channel; explicit configuration is required for outbound channel posts.
  if(old!=='@ar_downloaderbot'&&/^@[A-Za-z0-9_]{5,}$/.test(old))return old;
  return '';
}

function promoHour() {
  const value = Number(process.env.SUPPORT_PROMO_HOUR_MY ?? DEFAULT_PROMO_HOUR);
  if (!Number.isInteger(value) || value < 0 || value > 23) return DEFAULT_PROMO_HOUR;
  return value;
}

function channelPromoHour() {
  const value = Number(process.env.SUPPORT_CHANNEL_PROMO_HOUR_MY ?? DEFAULT_CHANNEL_PROMO_HOUR);
  if (!Number.isInteger(value) || value < 0 || value > 23) return DEFAULT_CHANNEL_PROMO_HOUR;
  return value;
}

function channelPromoMinute() {
  const value = Number(process.env.SUPPORT_CHANNEL_PROMO_MINUTE_MY ?? DEFAULT_CHANNEL_PROMO_MINUTE);
  if (!Number.isInteger(value) || value < 0 || value > 59) return DEFAULT_CHANNEL_PROMO_MINUTE;
  return value;
}

function channelTimeReached(parts = {}) {
  const hour = Number(parts.hour || 0);
  const minute = Number(parts.minute || 0);
  return hour > channelPromoHour()
    || (hour === channelPromoHour() && minute >= channelPromoMinute());
}

function malaysiaParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: MALAYSIA_TIMEZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    weekday: parts.weekday,
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/**
 * One promotional slot per calendar day (Asia/Kuala_Lumpur):
 * Friday 10:00, Saturday-Thursday 15:00. The mode is independent from
 * lock enforcement and never consumes a user's free successful use.
 */
export function supportPromotionScheduleState(date = new Date()) {
  const parts = malaysiaParts(date);
  const shared = isPayPingSharedConfigEnabled();
  const friday = parts.weekday === 'Fri';
  const scheduledHour = shared ? (friday ? 10 : 15) : channelPromoHour();
  const scheduledMinute = shared ? 0 : channelPromoMinute();
  const due = shared
    ? (parts.hour === scheduledHour && parts.minute >= scheduledMinute)
    : channelTimeReached(parts);
  return {
    ...parts,
    due,
    privateDue: shared ? due : (friday && parts.hour >= promoHour()),
    scheduledHour,
    scheduledMinute,
    timezone: MALAYSIA_TIMEZONE,
  };
}
export function supportChannelScheduleState(date = new Date()) {
  return supportPromotionScheduleState(date);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensurePromotionSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = await getSupportDb();
      await db.execute(`CREATE TABLE IF NOT EXISTS support_promotion_delivery (
        environment TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        period_key TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sent_at TEXT,
        PRIMARY KEY (environment, target_type, target_id, period_key)
      )`);
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

// Atomic once-per-day claim across restarts and replicas. Never retry a
// possibly delivered promotional Telegram message in the same local day.
async function claimPromotionSlot(targetType,targetId,periodKey){
  await ensurePromotionSchema();
  const client=await getSupportDb(),t=new Date().toISOString();
  const r=await client.execute({
    sql:"INSERT OR IGNORE INTO support_promotion_delivery(environment,target_type,target_id,period_key,status,created_at,updated_at) VALUES(?,?,?,?,'CLAIMED',?,?)",
    args:[currentSupportEnvironment(),targetType,String(targetId),periodKey,t,t],
  });
  return Number(r.rowsAffected||0)===1;
}

async function markDelivery(targetType, targetId, periodKey, status, errorMessage = '') {
  await ensurePromotionSchema();
  const db = await getSupportDb();
  const environment = currentSupportEnvironment();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO support_promotion_delivery (
            environment, target_type, target_id, period_key, status,
            error_message, created_at, updated_at, sent_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(environment, target_type, target_id, period_key) DO UPDATE SET
            status = excluded.status,
            error_message = excluded.error_message,
            updated_at = excluded.updated_at,
            sent_at = CASE WHEN excluded.status = 'SENT' THEN excluded.sent_at ELSE support_promotion_delivery.sent_at END`,
    args: [
      environment,
      targetType,
      String(targetId),
      periodKey,
      status,
      String(errorMessage || '').slice(0, 300),
      now,
      now,
      status === 'SENT' ? now : null,
    ],
  });
}

async function trackedUserIds() {
  try {
    const raw = await readFile(STATS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Object.keys(data?.users || {}).filter((id) => /^\d+$/.test(id));
  } catch (error) {
    console.warn('[support-promo] user registry read failed:', error?.message);
    return [];
  }
}

async function botUsername() {
  if (cachedBotUsername) return cachedBotUsername;
  const me = await telegram('getMe');
  cachedBotUsername = String(me?.username || '').replace(/^@/, '');
  return cachedBotUsername;
}

async function sendPrivatePromotion(userId, weekday) {
  await sendMessage(userId, supportCampaignText({ isFriday: weekday === 'Fri', audience: 'private' }), {
    reply_markup: supportMenuKeyboard(),
  });
}

async function sendChannelPromotion(channel, weekday) {
  const username = await botUsername();
  const url = username ? `https://t.me/${username}?start=support` : '';
  const message = weekday === 'Fri'
    ? supportCampaignText({ isFriday: true, audience: 'channel' })
    : dailyForcePremiumChannelSupportText();
  await sendSupportPromotionToChannel(channel, message, {
    ...(url ? {
      reply_markup: {
        inline_keyboard: [[{ text: '❤️ Support Bot', url }]],
      },
    } : {}),
  });
}

async function deliverChannelDaily(dateKey, weekday) {
  const target = await promotionalChannelTarget();
  if(!target){
    if(lastMissingChannelWarning!==dateKey){
      lastMissingChannelWarning=dateKey;
      console.warn('[support-promo] Channel reminder skipped: set MediaX channel @username in PayPing or SUPPORT_PROMOTION_CHANNEL_USERNAME in bot environment.');
    }
    return false;
  }
  const periodKey = `channel-daily:${dateKey}`;
  if (!(await claimPromotionSlot('CHANNEL', target, periodKey))) return false;
  try {
    await sendChannelPromotion(target, weekday);
    await markDelivery('CHANNEL', target, periodKey, 'SENT');
    console.log('[support-promo] channel sent', { target, periodKey });
    return true;
  } catch (error) {
    await markDelivery('CHANNEL', target, periodKey, 'FAILED', error?.message).catch(() => {});
    console.warn('[support-promo] channel send failed:', error?.message);
    return false;
  }
}

async function deliverPrivatePromotion({ dateKey, weekday }) {
  const users = await trackedUserIds();
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const periodKey = `all-users:${dateKey}`;

  for (const userId of users) {
    if (!(await claimPromotionSlot('PRIVATE', userId, periodKey))) {
      skipped += 1;
      continue;
    }

    try {
      // Existing supporters are not chased by the recurring promotion.
      if(await getActiveSupporterTitle(userId)){
        await markDelivery('PRIVATE', userId, periodKey, 'SKIPPED');
        skipped += 1;
        continue;
      }
      await sendPrivatePromotion(userId, weekday);
      await markDelivery('PRIVATE', userId, periodKey, 'SENT');
      sent += 1;
    } catch (error) {
      await markDelivery('PRIVATE', userId, periodKey, 'FAILED', error?.message).catch(() => {});
      failed += 1;
    }

    await sleep(PRIVATE_SEND_DELAY_MS);
  }

  console.log('[support-promo] private daily cycle complete', { users: users.length, sent, skipped, failed });
  return { users: users.length, sent, skipped, failed };
}

export async function runSupportPromotionCycle({ force = false } = {}) {
  if (cycleRunning) return { skipped: true, reason: 'already_running' };
  cycleRunning = true;
  try {
    const parts = supportPromotionScheduleState();
    const shared = isPayPingSharedConfigEnabled();
    const mode = shared ? 'PAYPING_SHARED' : await getFridaySupportMode();

    let channelSent = false;
    if (force || parts.due) {
      channelSent = await deliverChannelDaily(parts.dateKey, parts.weekday);
    }

    let privateResult = {
      skipped: true,
      reason: !parts.privateDue ? 'scheduled_later' : 'support_mode_off',
    };

    const privateReady = shared
      ? (force || parts.privateDue)
      : (mode !== FRIDAY_SUPPORT_MODE_OFF && (force || parts.privateDue));
    if (privateReady) {
      privateResult = await deliverPrivatePromotion(parts);
    }

    return {
      skipped: !channelSent && Boolean(privateResult?.skipped),
      channelSent,
      privateResult,
      parts,
      mode,
    };
  } finally {
    cycleRunning = false;
  }
}

export function startSupportPromotionScheduler() {
  startPaymentFollowupScheduler();
  if (schedulerTimer) return schedulerTimer;

  const run = () => {
    void runSupportPromotionCycle().catch((error) => {
      console.error('[support-promo] scheduler cycle failed:', error?.message);
    });
  };

  setTimeout(run, 20_000);
  schedulerTimer = setInterval(run, CHECK_INTERVAL_MS);
  schedulerTimer.unref?.();
  console.log('[support-promo] scheduler started', {
    timezone: MALAYSIA_TIMEZONE,
    fridayPromotions: isPayPingSharedConfigEnabled()?'10:00 MY (channel + private)':`${String(promoHour()).padStart(2,'0')}:00 MY (private)`,
    normalDayPromotions: isPayPingSharedConfigEnabled()?'15:00 MY (channel + private)':'legacy channel time',
    channel: process.env.SUPPORT_PROMOTION_CHANNEL_USERNAME||process.env.REQUIRED_CHANNEL_USERNAME||'PayPing saved channel',
    privateAudience: 'tracked non-supporters, once per Malaysia day',
  });
  return schedulerTimer;
}