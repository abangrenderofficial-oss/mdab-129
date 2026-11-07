import assert from 'node:assert/strict';
import { beginUpdate, allowRetryOfFailedUpdate } from '../src/recovery.js';

const now = Math.floor(Date.now() / 1000);
const update = (id, text, age = 0) => ({
  update_id: id,
  message: {
    message_id: id,
    date: now - age,
    chat: { id: 6749355196, type: 'private' },
    from: { id: 6749355196 },
    text,
  },
});

const delayedLink = update(930001, 'https://vt.tiktok.com/ZSphJKLNf/', 3 * 60);
assert.equal(beginUpdate(delayedLink).accept, true, '3 minute old media link should survive restart');
assert.equal(beginUpdate(delayedLink).reason, 'duplicate_update', 'only process once');
allowRetryOfFailedUpdate(delayedLink);
assert.equal(beginUpdate(delayedLink).accept, true, 'failed link can be retried');
assert.equal(beginUpdate(update(930002, 'ordinary text', 3 * 60)).reason, 'stale_update', 'non-link stale policy is unchanged');
assert.equal(beginUpdate(update(930003, 'https://vt.tiktok.com/ZSphJKLNf/', 11 * 60)).reason, 'stale_update', 'old links still expire');
console.log('MEDIAX_LINK_WEBHOOK_RETRY_SELFTEST_OK — delayed link accepted, failed delivery retryable, ordinary stale messages unaffected');
