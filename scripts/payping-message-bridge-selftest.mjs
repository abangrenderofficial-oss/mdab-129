import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatPayPingMessage} from '../src/support/payping-message-bridge.js';
const channel=readFileSync(new URL('../src/features/channel-gate.js',import.meta.url),'utf8');
const force=readFileSync(new URL('../src/support/daily-force.js',import.meta.url),'utf8');
const shared=readFileSync(new URL('../src/support/payping-shared-config.js',import.meta.url),'utf8');
const sql=readFileSync(new URL('../src/support/payping-message-bridge.js',import.meta.url),'utf8');
// Read-only source of message text; absolutely no mode or quota writes.
assert.match(sql,/SELECT body,button_enabled,button_label,button_url FROM payping_lock_replies_v1/);
assert.doesNotMatch(sql,/UPDATE payping_access_policies_v2|DELETE FROM|INSERT INTO/);
assert.match(channel,/await getMediaXLockCopy\('free_channel'/);
assert.match(force,/await getMediaXLockCopy\('force_support'/);
assert.match(force,/supportAmountKeyboard\(\)/);
assert.match(channel,/CHANNEL_VERIFY_CALLBACK/);
assert.match(shared,/getMediaXChannelRule/);
const txt=formatPayPingMessage('Hai <b>{first_name}</b>! 💜\\n<i>Sila join {channel}</i>',{first_name:'Ali & <C>',channel:'@official'});
assert.equal(txt,'Hai <b>Ali &amp; &lt;C&gt;</b>! 💜\n<i>Sila join @official</i>');
assert.ok(!txt.includes('<C>'));
console.log('MediaX PayPing lock-copy selftest passed: messages only, modes untouched');
