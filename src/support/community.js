import { sendMessage } from '../telegram.js';

function normalizedChannel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^-?\d+$/.test(raw)) return raw;
  if (raw.startsWith('@')) return raw;
  if (/^https?:\/\/t\.me\//i.test(raw)) {
    const slug = raw.replace(/^https?:\/\/t\.me\//i, '').split(/[/?#]/)[0];
    return slug ? `@${slug}` : '';
  }
  return `@${raw.replace(/^@/, '')}`;
}

export function supportChannelTarget() {
  return normalizedChannel(
    process.env.SUPPORT_CHANNEL_CHAT_ID
      || process.env.SUPPORT_CHANNEL_USERNAME
      || process.env.REQUIRED_CHANNEL_USERNAME
      || '@ar_downloaderbot',
  );
}

export async function publishSupportTestimonial({ displayName, supportMessage, tierLabel }) {
  const target = supportChannelTarget();
  if (!target) throw new Error('Support channel is not configured.');

  return sendMessage(
    target,
    [
      '❤️ Kata-kata Support',
      '',
      String(supportMessage || '').trim(),
      '',
      `— ${String(displayName || 'Supporter').trim()}`,
      String(tierLabel || '❤️ Supporter').trim(),
    ].filter(Boolean).join('\n'),
  );
}

export async function publishLuahRasa({ message, tierLabel }) {
  const target = supportChannelTarget();
  if (!target) throw new Error('Support channel is not configured.');

  return sendMessage(
    target,
    [
      '💭 #LuahRasa',
      '',
      String(message || '').trim(),
      '',
      `✨ ${String(tierLabel || '❤️ Supporter').trim()}`,
    ].filter(Boolean).join('\n'),
  );
}
