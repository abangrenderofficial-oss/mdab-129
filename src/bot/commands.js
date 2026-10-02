const START_LINES = [
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
  '• 📱 Status HQ - Status Whatsapp HD',
  '• 🍎 Live Wallpaper iPhone',
  '',
  'Boleh luahkan perasaan | Nasihat | Cerita | Tips korang di channel',
  '',
  'Tekan sini /luahrasa',
  '',
  '❤️ jom sama2 bantu kembangkan bot ni nak?',
  '',
  'Bot ni boleh mati bila2 masa if kita sama2 tak berjaya bayarkan kos sewa server. Sekali seumur hidup pun tak pe, Terima kasih orang baik ! 🙇🏻',
  '',
  'Tekan sini /support',
];

export const START_TEXT = START_LINES.join('\n');

export function startText() {
  return START_TEXT;
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
    '/forcesupport — Aktif setiap Jumaat sampai dihentikan',
    '/stopforcesupport — Hentikan Force Support',
    '/donatesupport — Aktif setiap Jumaat sampai dihentikan',
    '/stopdonatesupport — Hentikan Donate/Share Support',
    '/normalsupport — Aktif setiap Jumaat sampai dihentikan',
    '/stopnormalsupport — Hentikan Normal Support',
    '',
    'Daily Support Mode:',
    '/forcesupportdaily — Bagi 1 use, kemudian lock setiap hari sampai support',
    '/stopforcesupportdaily — Hentikan Daily Force Support',
    '',
    'Admin:',
    '/menuadmin — Senarai semua command admin',
    '/supporttest — Test payment gateway',
    '/supportperclick — Statistik click button Support',
    '/resetadmin — Reset & recovery semua user',
    '/resetchannel — Bersihkan leak Downloader Bot di channel',
    '/connect — Sambung group pemantauan video',
    '/disconnect — Putus group pemantauan video',
    '/connectquote — Sambung group filter quote & luah rasa',
    '/connectpaymentdetail — Sambung group notification payment support',
    '/pushsetup — Setup AR Payment push notification iPhone',
    '/totaluser — Statistik penggunaan bot',
    '/checkmember — Diagnostic membership channel',
    '/hqlab — HQ Lab owner-only',
    '/hqlab off — Tutup HQ Lab',
  ].join('\n');
}
