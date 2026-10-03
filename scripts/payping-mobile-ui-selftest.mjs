import { readFile } from 'node:fs/promises';

const pages = [
  'handlers/payping-home-pwa.js',
  'handlers/payping-transactions-pwa.js',
  'handlers/payping-transaction-detail-pwa.js',
  'handlers/payping-notifications-pwa.js',
  'handlers/payping-settings-pwa.js',
  'handlers/payping-analytics-pwa.js',
  'handlers/affiliate-pwa.js',
  'handlers/affiliate-admin-pwa.js',
];

function must(source, needle, label) {
  if (!source.includes(needle)) throw new Error(`${label} missing: ${needle}`);
}

for (const page of pages) {
  const source = await readFile(page, 'utf8');
  must(source, 'PAYPING_MOBILE_REFERENCE_V1', page);
  must(source, 'body::before', page);
  must(source, 'overflow:hidden;background-attachment:fixed;background-size:100vw 100vh;background-repeat:no-repeat', page);
  must(source, 'top:calc(env(safe-area-inset-top,0px) + 18px);height:1px;background:rgba(255,255,255,.06)', page);
  must(source, 'position:fixed;top:calc(env(safe-area-inset-top,0px) + 19px)', page);
  must(source, 'overflow-y:auto;-webkit-overflow-scrolling:touch', page);
  must(source, 'padding-right:calc(18px + env(safe-area-inset-right))', page);
  must(source, 'padding-left:calc(18px + env(safe-area-inset-left))', page);
  must(source, '.title{font-size:24px;line-height:1.08}', page);
}

for (const page of pages.filter((p) => !p.endsWith('affiliate-admin-pwa.js'))) {
  const source = await readFile(page, 'utf8');
  must(source, 'nav{z-index:1002;left:0;transform:none;bottom:0;width:100%', page);
  must(source, 'background:#07070d;border:0;border-radius:0;backdrop-filter:none;box-shadow:none', page);
  must(source, 'nav a{font-size:12px;gap:4px}', page);
  must(source, 'nav b{font-size:24px;line-height:1}', page);
}

const home = await readFile('handlers/payping-home-pwa.js', 'utf8');
must(home, '.cardTitle{font-size:16px}', 'home typography');
must(home, '.quick a{font-size:14px}', 'home quick actions');
must(home, '.meta{font-size:11px}', 'home metadata');

console.log('PAYPING_MOBILE_UI_SELFTEST_OK');
