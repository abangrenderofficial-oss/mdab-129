import { readFile } from 'node:fs/promises';

function assert(value, message) {
  if (!value) throw new Error(message);
}
function must(source, needle, label) {
  if (!source.includes(needle)) throw new Error(`${label} missing: ${needle}`);
}

const [handler, quote, audit, payment, stats] = await Promise.all([
  readFile('handlers/telegram.js', 'utf8'),
  readFile('src/features/quote-filter.js', 'utf8'),
  readFile('src/bot/audit.js', 'utf8'),
  readFile('src/features/payment-detail.js', 'utf8'),
  readFile('src/bot/stats.js', 'utf8'),
]);

must(handler, 'rejectNonOwnerGroupMessage', 'group message guard');
must(handler, 'rejectNonOwnerGroupCallback', 'group callback guard');
must(handler, "ignored: 'group_owner_only'", 'early webhook rejection');
must(handler, "if (!userId || isResetAdmin(userId)) return false;", 'owner bypass');
must(handler, "extractFirstUrl(text)", 'group link detection');
must(handler, "message?.video", 'group media detection');

const guardIndex = handler.indexOf('if (message && await rejectNonOwnerGroupMessage(message))');
const commandIndex = handler.indexOf("if (command === '/menu')");
assert(guardIndex >= 0 && commandIndex >= 0 && guardIndex < commandIndex, 'group guard must run before command dispatch');

must(quote, 'Hanya owner bot boleh Approve / Reject.', 'quote owner-only moderation');
must(audit, 'Hanya owner bot boleh delete rekod ini.', 'audit delete owner-only');
must(payment, 'Hanya owner bot boleh buka Support Monitor.', 'support monitor owner-only');
must(stats, 'Hanya owner bot boleh guna /totaluser.', 'stats owner-only');

console.log('GROUP_OWNER_ONLY_SELFTEST_OK');
