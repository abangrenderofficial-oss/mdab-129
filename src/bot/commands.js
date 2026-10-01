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

// Safe public /start and /help text. Support is intentionally hidden from normal users for now.
export const START_TEXT = START_BASE_LINES.join('\n');

export function startText(userId) {
  if (!isResetAdmin(userId)) return START_TEXT;
  return [...START_BASE_LINES, '', ...OWNER_SUPPORT_LINES].join('\n');
}

export function commandMenuText(userId) {
  const lines = [
    '📋 Command Menu',
    '',
    '/start — Info bot',
    '/help — Bantuan ringkas',
    '/menu — Senarai command',
    '/status <link> — Buat Status HQ dari link',
    '/luahrasa — Luah rasa / share cerita ke channel',
    '/reset — Reset sesi sendiri jika bot tersangkut',
  ];

  if (isResetAdmin(userId)) {
    lines.push(
      '',
      '👑 Owner',
      '/support — ❤️ Support bot',
      '/supporttest — Test payment gateway',
      '/resetadmin — Reset & recovery semua user',
      '/connect — Sambung group pemantauan video',
      '/connectquote — Sambung group filter quote & luah rasa',
      '/disconnect — Putus group pemantauan video',
      '/totaluser — Statistik penggunaan bot',
    );
  }
  return lines.join('\n');
}
