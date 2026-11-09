// TikTok "hidden video" rescue. Used ONLY when a TikTok link resolves to
// audio-only candidates (e.g. promoted/ad posts: TikTok hides the MP4 on web
// and TikWM blocks the Bot Hosting IP, so yt-dlp returns just an MP3).
// Normal TikTok links never match isAudioOnlyTikTok() and keep the old flow.
const AUDIO_EXTS = new Set(['mp3', 'm4a', 'aac', 'opus', 'ogg', 'wav', 'weba']);
const WORKFLOW = 'tiktok-hidden-video.yml';

function extOf(item) {
  const declared = String(item?.ext || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (declared) return declared;
  try {
    const match = new URL(String(item?.url || '')).pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

export function isAudioOnlyTikTok(candidates) {
  const list = Array.isArray(candidates) ? candidates.filter((item) => item?.url) : [];
  return list.length > 0 && list.every((item) => AUDIO_EXTS.has(extOf(item)) && !Number(item?.width) && !Number(item?.height));
}

export async function dispatchHiddenTikTokWorker({ chatId, sourceUrl, replyMarkup = null }) {
  const chat = String(chatId || '').trim();
  const source = String(sourceUrl || '').trim();
  const token = String(process.env.GITHUB_ACTIONS_TOKEN || process.env.GH_ACTIONS_TOKEN || '').trim();
  if (!/^-?[0-9]+$/.test(chat) || !source || !token) {
    throw new Error('TikTok hidden-video worker is missing chat, source or GitHub credentials.');
  }
  const parsed = new URL(source);
  const host = String(parsed.hostname || '').toLowerCase();
  if (parsed.protocol !== 'https:' || !(host === 'tiktok.com' || host.endsWith('.tiktok.com'))) {
    throw new Error('Hidden-video worker accepts HTTPS TikTok links only.');
  }
  const owner = String(process.env.GITHUB_WORKER_OWNER || 'abangrenderofficial-oss').trim();
  const repo = String(process.env.GITHUB_WORKER_REPO || 'mdab-129').trim();
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${WORKFLOW}/dispatches`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'MediaX-TikTok-Hidden-Video',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ref: 'main',
      inputs: {
        chat_id: chat,
        source_url: source,
        reply_markup: replyMarkup ? JSON.stringify(replyMarkup) : '',
      },
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (response.status !== 204) {
    const detail = (await response.text().catch(() => '')).slice(0, 260);
    throw new Error(`Hidden-video worker dispatch returned HTTP ${response.status}: ${detail}`);
  }
  return { dispatched: true };
}
