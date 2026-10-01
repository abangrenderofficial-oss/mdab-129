import { isResetAdmin } from '../recovery.js';

const START_BASE_LINES = [
  '📥 Social Downloader Bot',
  '',
  'Hantar link public daripada:',
  '• TikTok',
  '• Instagram Reels / Post',
  '• Threads',
  '• YouTube / Shorts / unlisted',
  '',
  'Bot akan cuba hantar semula media dalam chat dan user boleh download.',
  '',
  'Boleh juga upload media video atau photo dari gallery untuk:',
  '• 📱 Status HQ',
  '• 🍎 Live Wallpaper iPhone',
];

const OWNER_SUPPORT_LINES = [
  '❤️ jom sama2 bantu kembangkan bot ni nak?',
  '',
  'Bot ni boleh mati bila2 masa if kita sama2 tak berjaya bayarkan kos sewa server. Sekali seumur hidup pun tak pe, Terima kasih orang baik ! 🙇🏻',
  '',
  'Tekan sini /support',
];

export const START_TEXT = START_BASE_LINES.join('\n');

export function startText(userId) {
  if (!isResetAdmin(userId)) return START_TEXT;
  return [...START_BASE_LINES, '', ...OWNER_SUPPORT_LINES].join('\n');
}

export function commandMenuText() {
  return [
    '📋 Command Menu',
    '',
    '/start — Info bot',
    '/help — Bantuan ringkas',
    '/menu — Senarai command user',
    '/status <link> — Buat Status HQ dari link',
    '/support — ❤️ Support perkembangan bot',
    '/luahrasa — Luah rasa / share cerita',
    '/reset — Reset sesi sendiri jika bot tersangkut',
  ].join('\n');
}

export function adminCommandMenuText() {
  return [
    '👑 Admin Command Menu',
    '',
    'Public:',
    '/start — Info bot',
    '/help — Bantuan ringkas',
    '/menu — Senarai command user',
    '/status <link> — Buat Status HQ dari link',
    '/support — Support perkembangan bot',
    '/luahrasa — Luah rasa / share cerita',
    '/reset — Reset sesi sendiri',
    '',
    'Friday Support Mode:',
    '/forcesupport — Jumaat: promo 10AM → 1 use → non-supporter wajib RM10+ untuk use seterusnya',
    '/donatesupport — Jumaat: promo 10AM → 1 use → non-supporter klik 3 share steps untuk unlock',
    '/normalsupport — Jumaat: promo 10AM + reminder selepas 1 use, tapi semua user kekal bebas guna',
    '',
    'Admin:',
    '/menuadmin — Senarai semua command admin',
    '/supporttest — Test payment gateway',
    '/resetadmin — Reset & recovery semua user',
    '/resetchannel — Bersihkan leak Downloader Bot di channel',
    '/connect — Sambung group pemantauan video',
    '/disconnect — Putus group pemantauan video',
    '/connectquote — Sambung group filter quote & luah rasa',
    '/totaluser — Statistik penggunaan bot',
    '/checkmember — Diagnostic membership channel',
    '/hqlab — HQ Lab owner-only',
    '/hqlab off — Tutup HQ Lab',
  ].join('\n');
}
