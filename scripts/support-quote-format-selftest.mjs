import { readFile } from 'node:fs/promises';

const [quote, support] = await Promise.all([
  readFile('src/support/quote-filter.js', 'utf8'),
  readFile('src/features/support.js', 'utf8'),
]);

function must(source, needle, label) {
  if (!source.includes(needle)) throw new Error('SUPPORT_QUOTE_FORMAT_SELFTEST_FAILED: ' + label + ' missing ' + needle);
}

must(quote, "'Kata Support Buat Team MediaX👏🏻'", 'MediaX heading');
must(quote, "|| 'Anonymous'", 'Anonymous fallback');
must(quote, "`From ${tier}`", 'tier footer');
must(quote, "`“${message}”`", 'quoted supporter message');
must(support, "SUPPORT_ANONYMOUS_NAME_ACTION = 'support:name:anonymous'", 'Anonymous callback action');
must(support, "text: 'Anonymous'", 'Anonymous button');
must(support, "setSupportSubmissionName(submission.orderNumber, user.id, 'Anonymous')", 'Anonymous persistence');

console.log('SUPPORT_QUOTE_FORMAT_SELFTEST_OK');
