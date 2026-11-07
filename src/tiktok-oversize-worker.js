// Large TikTok originals are dispatched to an external GitHub runner.
// This module never changes original MediaX social-video or Status HQ codec settings.
import { createOversizeTikTokSourceTicket, revokeOversizeTikTokSourceTicket, oversizeSourcePath } from './tiktok-oversize-stream.js';
const OVERSIZE_THRESHOLD_BYTES = 128 * 1024 * 1024;
const WORKFLOW = 'mediax-oversize-social.yml';

export function requiresOversizeTikTokWorker(candidates, uploadMaxBytes) {
  const list = Array.isArray(candidates) ? candidates : [];
  const maxBytes = Number(uploadMaxBytes || 0);
  return list.length > 0 && Number.isFinite(maxBytes) && maxBytes > 0
    && list.every(item => {
      const bytes = Number(item?.filesize || 0);
      return Number.isFinite(bytes) && bytes >= OVERSIZE_THRESHOLD_BYTES && bytes > maxBytes;
    });
}

export async function dispatchOversizeTikTokWorker({ chatId, sourceUrl }) {
  const chat = String(chatId || '').trim();
  const source = String(sourceUrl || '').trim();
  const token = String(process.env.GITHUB_ACTIONS_TOKEN || process.env.GH_ACTIONS_TOKEN || '').trim();
  if (!/^[-]?[0-9]+$/.test(chat) || !source || !token) {
    throw new Error('TikTok oversized worker is missing verified chat, source or GitHub credentials.');
  }
  const parsed = new URL(source);
  const host = String(parsed.hostname || '').toLowerCase();
  if (parsed.protocol !== 'https:' || !(host === 'tiktok.com' || host.endsWith('.tiktok.com'))) {
    throw new Error('Oversized TikTok worker accepts HTTPS TikTok links only.');
  }

  const owner = String(process.env.GITHUB_WORKER_OWNER || 'abangrenderofficial-oss').trim();
  const repo = String(process.env.GITHUB_WORKER_REPO || 'mdab-129').trim();
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${WORKFLOW}/dispatches`;
  const origin = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (!origin.startsWith('https://')) throw new Error('Oversize worker needs a trusted PUBLIC_BASE_URL.');
  const ticket = createOversizeTikTokSourceTicket(source);
  const streamUrl = `${origin}${oversizeSourcePath()}?ticket=${ticket}`;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'MediaX-Oversize-Delivery',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: { chat_id: chat, source_url: source, stream_url: streamUrl } }),
      signal: AbortSignal.timeout(12000),
    });
    if (response.status !== 204) {
      const detail = (await response.text().catch(() => '')).slice(0, 260);
      throw new Error(`Oversized TikTok worker dispatch returned HTTP ${response.status}: ${detail}`);
    }
    return { dispatched: true, sourceUrl: source };
  } catch (error) {
    revokeOversizeTikTokSourceTicket(ticket);
    throw error;
  }
}
