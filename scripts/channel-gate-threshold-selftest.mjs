import { rm, writeFile } from 'node:fs/promises';

const statsFile = `/tmp/channel-gate-threshold-${process.pid}.json`;
process.env.STATS_FILE_PATH = statsFile;

const legacyUserId = 900000001;
const newUserId = 900000002;

await writeFile(statsFile, JSON.stringify({
  version: 2,
  trackingSince: new Date().toISOString(),
  users: {
    [legacyUserId]: {
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      premiumHqCompletedCount: 3,
      premiumHqCompleted: true,
      completedUse: true,
      channelGateCounterVersion: 2,
      channelUseCount: 5,
      joinPromptSent: true,
    },
  },
  monthlyDownloads: {},
}), 'utf8');

const {
  CHANNEL_GATE_THRESHOLD,
  getChannelUseCount,
  hasChannelGateRequired,
  hasJoinPromptBeenSent,
  markPremiumHqCompleted,
  recordUsage,
} = await import('../src/bot/stats.js');

try {
  if (CHANNEL_GATE_THRESHOLD !== 5) {
    throw new Error(`Expected threshold 5, got ${CHANNEL_GATE_THRESHOLD}`);
  }

  // Existing users from the old counter version restart under the current rollout.
  await recordUsage(legacyUserId);
  const legacyCount = await getChannelUseCount(legacyUserId);
  const legacyGated = await hasChannelGateRequired(legacyUserId);
  const legacyPromptSent = await hasJoinPromptBeenSent(legacyUserId);
  if (legacyCount !== 0 || legacyGated || legacyPromptSent) {
    throw new Error(`Legacy reset failed: count=${legacyCount}, gated=${legacyGated}, prompt=${legacyPromptSent}`);
  }

  // Normal downloads, Status HQ accounting and Live Wallpaper do not count
  // toward this gate. Only a successful Premium+ HQ completion counts.
  const events = ['download', 'status_hq', 'live_wallpaper', 'download', 'status_hq'];
  for (const event of events) {
    await recordUsage(newUserId, event);
    const count = await getChannelUseCount(newUserId);
    const gated = await hasChannelGateRequired(newUserId);
    if (count !== 0 || gated) {
      throw new Error(`Non-Premium event triggered gate: event=${event}, count=${count}, gated=${gated}`);
    }
  }

  for (let use = 1; use <= 4; use += 1) {
    const counted = await markPremiumHqCompleted(newUserId, `test-use-${use}`);
    const count = await getChannelUseCount(newUserId);
    const gated = await hasChannelGateRequired(newUserId);
    if (!counted || count !== use || gated) {
      throw new Error(`Gate triggered too early at Premium HQ use ${use}: counted=${counted}, count=${count}, gated=${gated}`);
    }
  }

  const fifthCounted = await markPremiumHqCompleted(newUserId, 'test-use-5');
  const fifthCount = await getChannelUseCount(newUserId);
  const fifthGated = await hasChannelGateRequired(newUserId);
  if (!fifthCounted || fifthCount !== 5 || !fifthGated) {
    throw new Error(`Fifth Premium HQ did not activate gate: counted=${fifthCounted}, count=${fifthCount}, gated=${fifthGated}`);
  }

  // Retry of the same successful delivery must not become a sixth use.
  const duplicateCounted = await markPremiumHqCompleted(newUserId, 'test-use-5');
  const afterDuplicate = await getChannelUseCount(newUserId);
  if (duplicateCounted || afterDuplicate !== 5) {
    throw new Error(`Duplicate completion changed gate counter: counted=${duplicateCounted}, count=${afterDuplicate}`);
  }

  await recordUsage(newUserId);
  const afterPassiveUpdate = await getChannelUseCount(newUserId);
  if (afterPassiveUpdate !== 5) {
    throw new Error(`Passive webhook update changed count: ${afterPassiveUpdate}`);
  }

  const invalidAccepted = await recordUsage(newUserId, 'not-a-real-use');
  const afterInvalid = await getChannelUseCount(newUserId);
  if (invalidAccepted || afterInvalid !== 5) {
    throw new Error(`Invalid event changed count: accepted=${invalidAccepted}, count=${afterInvalid}`);
  }

  console.log('CHANNEL_GATE_THRESHOLD_SELFTEST_OK', JSON.stringify({
    threshold: CHANNEL_GATE_THRESHOLD,
    firstFourPremiumHqUsesFree: true,
    gateAfterSuccessfulUse: 5,
    duplicateCompletionIsIdempotent: true,
    normalFeaturesDoNotCount: true,
    passiveUpdatesDoNotCount: true,
  }));
} finally {
  await rm(statsFile, { force: true }).catch(() => {});
}
