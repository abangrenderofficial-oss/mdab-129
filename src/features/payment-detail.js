import { isResetAdmin } from '../recovery.js';
import { sendMessage, telegram } from '../telegram.js';
import { getPaymentDetailGroup, setPaymentDetailGroup } from '../support/payment-detail.js';
import { getSupportMonitorReport, getSupportMonitorUserStatus } from '../support/monitor.js';
import { refreshSupportMonitorMessage } from '../support/monitor-publisher.js';

async function isGroupAdmin(chatId, userId) {
  if (!chatId || !userId) return false;
  try {
    const member = await telegram('getChatMember', { chat_id: chatId, user_id: userId });
    return member?.status === 'creator' || member?.status === 'administrator';
  } catch {
    return false;
  }
}

export async function handleConnectPaymentDetailCommand(message = {}) {
  const chatId = message?.chat?.id;
  const chatType = message?.chat?.type;
  const userId = message?.from?.id;
  if (!chatId || !userId) return true;

  if (!['group', 'supergroup'].includes(chatType)) {
    await sendMessage(chatId, '❌ /connectpaymentdetail hanya boleh digunakan dalam group Telegram.').catch(() => {});
    return true;
  }
  if (!isResetAdmin(userId)) {
    await sendMessage(chatId, '❌ /connectpaymentdetail hanya untuk admin bot.').catch(() => {});
    return true;
  }
  if (!(await isGroupAdmin(chatId, userId))) {
    await sendMessage(chatId, '❌ Admin bot mesti juga menjadi admin group ini untuk guna /connectpaymentdetail.').catch(() => {});
    return true;
  }

  try {
    await setPaymentDetailGroup(chatId, message?.chat?.title || '', userId);
    await sendMessage(chatId, [
      '✅ Payment Detail Group Connected',
      '',
      'Mulai sekarang setiap support payment yang berjaya akan dihantar ke group ini.',
      '',
      'Format ringkas notification: ID User - Amount - Successful ✅',
      'Detail akan sertakan ID user, nama, amount, type of support, date, time dan period tier 12 bulan.',
      '',
      'Monitoring:',
      '/supportmonitor — senarai supported / belum support',
      '/supportcheck <TelegramID> — semak seorang user',
    ].join('\n'));
    await refreshSupportMonitorMessage({ force: true }).catch((error) => {
      console.warn('[support-monitor] initial auto monitor failed:', error?.message);
    });
  } catch (error) {
    console.error('[connectpaymentdetail] failed:', error?.message);
    await sendMessage(chatId, '❌ Tak berjaya connect group payment detail sekarang. Cuba sekali lagi.').catch(() => {});
  }
  return true;
}


function monitorDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function monitorIdentity(user = {}) {
  if (user.username) return `@${user.username}`;
  if (user.displayName) return user.displayName;
  return `ID ${user.userId || '-'}`;
}

function monitorDailyLabel(user = {}) {
  const daily = user.dailyForce || {};
  if (user.support?.active) return 'EXEMPT';
  if (daily.state === 'PAUSED_FRIDAY') return `PAUSED FRIDAY · cycle ${daily.cycleId} · Friday Support System handle`;
  if (daily.state === 'PROCESSING_FIRST_USE') return `PROCESSING FIRST USE · cycle ${daily.cycleId}`;
  if (daily.state === 'LOCKED') {
    return `LOCKED · cycle ${daily.cycleId} · success ${daily.successCount}${daily.anomaly ? ' ⚠️' : ''}`;
  }
  if (daily.state === 'FREE_USE_AVAILABLE') return `FREE 1x · cycle ${daily.cycleId}`;
  return 'OFF';
}

async function validateSupportMonitorAccess(message = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  const chatType = message?.chat?.type;
  if (!chatId || !userId) return { ok: false, chatId, userId };

  if (!['group', 'supergroup'].includes(chatType)) {
    await sendMessage(chatId, '❌ Support Monitor hanya boleh digunakan dalam group Payment Detail.').catch(() => {});
    return { ok: false, chatId, userId };
  }

  const target = await getPaymentDetailGroup();
  if (!target?.groupId || String(target.groupId) !== String(chatId)) {
    await sendMessage(chatId, '❌ Group ini bukan Payment Detail group yang sedang connected.').catch(() => {});
    return { ok: false, chatId, userId };
  }

  if (!isResetAdmin(userId) && !(await isGroupAdmin(chatId, userId))) {
    await sendMessage(chatId, '❌ Hanya admin boleh buka Support Monitor.').catch(() => {});
    return { ok: false, chatId, userId };
  }

  return { ok: true, chatId, userId, target };
}

async function sendMonitorSection(chatId, title, lines = []) {
  if (!lines.length) {
    await sendMessage(chatId, `${title}\n\n- Tiada rekod -`).catch(() => {});
    return;
  }

  let chunk = `${title}\n`;
  for (const line of lines) {
    const candidate = `${chunk}\n${line}`;
    if (candidate.length > 3500) {
      await sendMessage(chatId, chunk).catch(() => {});
      chunk = `${title} (sambungan)\n\n${line}`;
    } else {
      chunk = candidate;
    }
  }
  if (chunk.trim()) await sendMessage(chatId, chunk).catch(() => {});
}

export async function handleSupportMonitorCommand(message = {}) {
  const access = await validateSupportMonitorAccess(message);
  if (!access.ok) return true;

  try {
    const report = await getSupportMonitorReport(80);
    await sendMessage(access.chatId, [
      '📊 SUPPORT MONITOR',
      '',
      `Recent tracked users: ${report.users.length}`,
      `✅ Active supporter: ${report.supported.length}`,
      `❌ Belum support: ${report.unsupported.length}`,
      `🔒 Locked Daily Force: ${report.locked.length}`,
      `⚠️ Cycle anomaly (>1 success): ${report.anomalies.length}`,
      report.dailyForceEnabled
        ? (
            report.dailyForcePausedForFriday
              ? `Daily Force: ON · PAUSED FRIDAY · Cycle ${report.cycleId}`
              : `Daily Force: ON · Sabtu–Khamis · Cycle ${report.cycleId}`
          )
        : 'Daily Force: OFF',
      '',
      'Semak seorang user: /supportcheck <TelegramID>',
    ].join('\n'));

    const supportedLines = report.supported.map((user) => (
      `✅ ${monitorIdentity(user)} · ID ${user.userId}\n`
      + `   ${user.support.tierLabel} · until ${monitorDate(user.support.expiresAt)}`
    ));
    const unsupportedLines = report.unsupported.map((user) => (
      `${user.dailyForce.anomaly ? '⚠️' : '❌'} ${monitorIdentity(user)} · ID ${user.userId}\n`
      + `   Daily: ${monitorDailyLabel(user)}`
    ));

    await sendMonitorSection(access.chatId, '✅ ACTIVE SUPPORTERS', supportedLines);
    await sendMonitorSection(access.chatId, '❌ BELUM SUPPORT', unsupportedLines);
  } catch (error) {
    console.error('[support-monitor] report failed:', error?.message);
    await sendMessage(access.chatId, '❌ Support Monitor tak dapat dibaca sekarang. Cuba lagi.').catch(() => {});
  }
  return true;
}

export async function handleSupportCheckCommand(message = {}) {
  const access = await validateSupportMonitorAccess(message);
  if (!access.ok) return true;

  const parts = String(message?.text || '').trim().split(/\s+/);
  const targetUserId = String(parts[1] || '').trim();
  if (!/^\d+$/.test(targetUserId)) {
    await sendMessage(access.chatId, 'Guna: /supportcheck <TelegramID>\nContoh: /supportcheck 705646577').catch(() => {});
    return true;
  }

  try {
    const user = await getSupportMonitorUserStatus(targetUserId);
    if (!user) {
      await sendMessage(access.chatId, '❌ User ID tak sah.').catch(() => {});
      return true;
    }

    const supportLines = user.support.active
      ? [
          'Support: ✅ ACTIVE',
          `Tier: ${user.support.tierLabel}`,
          `Amount: RM${user.support.amount}`,
          `Paid: ${monitorDate(user.support.paidAt)}`,
          `Expiry: ${monitorDate(user.support.expiresAt)}`,
          `Order: ${user.support.orderNumber}`,
        ]
      : ['Support: ❌ BELUM SUPPORT'];

    await sendMessage(access.chatId, [
      '🔎 SUPPORT CHECK',
      '',
      `User: ${monitorIdentity(user)}`,
      `Telegram ID: ${user.userId}`,
      ...supportLines,
      '',
      `Daily Force: ${monitorDailyLabel(user)}`,
      `Cycle success count: ${user.dailyForce.successCount || 0}`,
      user.dailyForce.anomaly ? '⚠️ ANOMALY: non-supporter berjaya lebih 1x dalam cycle ini.' : '',
      user.monitor.lastSeenAt ? `Last seen: ${monitorDate(user.monitor.lastSeenAt)}` : '',
    ].filter(Boolean).join('\n'));
  } catch (error) {
    console.error('[support-monitor] user check failed:', error?.message);
    await sendMessage(access.chatId, '❌ Tak dapat semak status user sekarang.').catch(() => {});
  }
  return true;
}

export async function handlePaymentDetailTestCommand(message = {}) {
  const chatId = message?.chat?.id;
  const userId = message?.from?.id;
  if (!chatId || !userId) return true;

  if (!isResetAdmin(userId)) {
    await sendMessage(chatId, '❌ /testpaymentdetail hanya untuk admin bot.').catch(() => {});
    return true;
  }

  if (message?.chat?.type !== 'private') {
    await sendMessage(chatId, '❌ /testpaymentdetail hanya boleh digunakan dalam private chat bot.').catch(() => {});
    return true;
  }

  try {
    const target = await getPaymentDetailGroup();
    if (!target?.groupId) {
      await sendMessage(chatId, '❌ Belum ada group /connectpaymentdetail.').catch(() => {});
      return true;
    }

    const sent = await sendMessage(
      target.groupId,
      [
        'ID 123456789 - RM10.00 - Successful ✅',
        '',
        'ID user - 123456789',
        'Nama - Test User',
        'Amount - RM10.00',
        'Type of support - 🤍 Supporter',
        'Date - 3 Oct 2026',
        'Time - 12:15:32 AM',
        'Period - 3 Oct 2026 sampai 3 Oct 2027 (12 bulan)',
        '',
        'TEST ONLY — notification preview check',
      ].join('\n'),
    );

    await sendMessage(
      chatId,
      `✅ Test notification dah dihantar ke group payment detail. Message ID: ${sent?.message_id || '-'}`,
    ).catch(() => {});
  } catch (error) {
    console.error('[testpaymentdetail] failed:', error?.message);
    await sendMessage(chatId, '❌ Test notification gagal dihantar.').catch(() => {});
  }

  return true;
}
