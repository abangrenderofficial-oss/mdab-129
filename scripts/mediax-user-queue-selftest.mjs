import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  enqueueUserHeavyJob, resetUserHeavyQueue, userHeavyQueueInfo,
  currentUserJobSignal,
} from '../src/bot/user-job-queue.js';

const execFileAsync = promisify(execFile);
process.env.HEAVY_GLOBAL_CONCURRENCY = '1';
const first = enqueueUserHeavyJob(771001, async () => {
  const signal = currentUserJobSignal();
  assert.ok(signal, 'running job carries a cancellation signal');
  try {
    await execFileAsync(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      signal,
      killSignal: 'SIGKILL',
    });
    throw new Error('The long child should not finish on its own.');
  } catch (error) {
    if (!signal.aborted) throw error;
    return 'ABORTED';
  }
});
assert.equal(first.accepted, true);
const waiting = enqueueUserHeavyJob(771001, async () => 'SHOULD_NOT_RUN');
assert.equal(waiting.queued, true);
const next = enqueueUserHeavyJob(772002, async () => {
  assert.equal(currentUserJobSignal()?.aborted, false);
  return 'OTHER_USER_SUCCESS';
});
await new Promise(resolve => setTimeout(resolve, 100));
const reset = resetUserHeavyQueue(771001);
assert.equal(reset.hadActive, true);
assert.equal(reset.clearedWaiting, 1);
assert.equal(await first.done, 'ABORTED', 'reset must terminate a running child process');
assert.equal((await waiting.done).cancelled, true, 'reset removes waiting jobs');
assert.equal(await next.done, 'OTHER_USER_SUCCESS', 'other user must progress after reset');
await new Promise(resolve => setImmediate(resolve));
assert.equal(userHeavyQueueInfo(772002).globalActive, 0);
console.log('MEDIAX_USER_QUEUE_SELFTEST_OK — active subprocess cancelled; waiting queue cleared; second user proceeds');
