import {isPayPingSharedConfigEnabled} from '../support/payping-shared-config.js';
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
    '/affiliate — 💰 Referral link & affiliate wallet',
    '/withdraw — Request affiliate payout',
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
    ...(isPayPingSharedConfigEnabled()?[
      'Force Support (setiap hari):',
      '/forcesupport — Force Support ON, 1 successful use free kemudian locked',
      '/normalsupport — Force Support OFF, kembali Free',
      '/forcesupportdaily — Alias untuk /forcesupport',
      '/stopforcesupportdaily — Alias untuk /normalsupport',
      '',
    ]:[
      'Friday Support Mode:',
      '/forcesupport — Aktif setiap Jumaat sampai dihentikan',
      '/stopforcesupport — Hentikan Force Support',
      '/donatesupport — Aktif setiap Jumaat sampai dihentikan',
      '/stopdonatesupport — Hentikan Donate/Share Support',
      '/normalsupport — Aktif setiap Jumaat sampai dihentikan',
      '/stopnormalsupport — Hentikan Normal Support',
      '',
      'Daily Support Mode:',
      '/forcesupportdaily — Persistent Sabtu–Khamis; Jumaat auto-pause sampai /stopforcesupportdaily',
      '/stopforcesupportdaily — Hentikan persistent Daily Force Sabtu–Khamis',
      '',
    ]),
    'Admin:',
    '/menuadmin — Senarai semua command admin',
    '/supporttest — Test payment gateway',
    '/supportperclick — Statistik click button Support',
    '/supportmonitor — Senarai supported / belum support (Payment Detail group)',
    '/supportcheck <TelegramID> — Semak status support seorang user',
    '/resetadmin — Reset & recovery semua user',
    '/resetchannel — Bersihkan leak Downloader Bot di channel',
    '/connect — Sambung group pemantauan video',
    '/disconnect — Putus group pemantauan video',
    '/connectquote — Sambung group filter quote & luah rasa',
    '/connectpaymentdetail — Sambung group notification payment support',
    '/pushsetup — Setup AR Payment push notification iPhone',
    '/affiliatepaid <request> — Tandakan affiliate payout paid',
    '/affiliatereject <request> — Batalkan affiliate withdrawal',
    '/totaluser — Statistik penggunaan bot',
    '/checkmember — Diagnostic membership channel',
    '/hqlab — HQ Lab owner-only',
    '/hqlab off — Tutup HQ Lab',
  ].join('\n');
}
