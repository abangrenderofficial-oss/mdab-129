import assert from 'node:assert/strict';
import { createStatsPersistence } from '../src/bot/stats-persistence.js';

const initial = {
  version: 2,
  trackingSince: '2026-10-01T00:00:00.000Z',
  users: {'100': {channelUseCount: 4, completedUse: true}},
  monthlyDownloads: {'2026-10': 19},
};
let file = JSON.stringify(initial);
const fakeFs = {
  readFile: async () => { if (file === null) { const e = new Error('missing'); e.code='ENOENT'; throw e; } return file; },
  mkdir: async () => {},
  writeFile: async (_p, content) => { fakeFs.pending = content; },
  rename: async () => { file = fakeFs.pending; },
};
const snapshots = new Map();
const backups = new Map();
let failDatabase = false;
let dbWriteCount = 0;
const db = {
  async execute(query) {
    if (failDatabase) throw new Error('simulated turso outage');
    const sql = typeof query === 'string' ? query : query.sql;
    const args = typeof query === 'string' ? [] : query.args;
    if (sql.startsWith('CREATE TABLE')) return {rows:[],rowsAffected:0};
    if (sql.startsWith('SELECT payload_json')) {
      const entry = snapshots.get(args[0]);
      return {rows:entry ? [{payload_json:entry}] : [],rowsAffected:0};
    }
    if (sql.startsWith('INSERT OR IGNORE INTO mediax_statistics_seed_backup')) {
      if (!backups.has(args[0])) backups.set(args[0],args[1]);
      return {rows:[],rowsAffected:1};
    }
    if (sql.startsWith('INSERT OR IGNORE INTO mediax_statistics_snapshot')) {
      if (!snapshots.has(args[0])) snapshots.set(args[0],args[1]);
      dbWriteCount++;
      return {rows:[],rowsAffected:1};
    }
    if (sql.startsWith('INSERT INTO mediax_statistics_snapshot')) {
      snapshots.set(args[0],args[1]);
      dbWriteCount++;
      return {rows:[],rowsAffected:1};
    }
    if (sql.startsWith('UPDATE mediax_statistics_snapshot')) {
      if (!snapshots.has(args[2])) return {rows:[],rowsAffected:0};
      snapshots.set(args[2],args[0]);
      dbWriteCount++;
      return {rows:[],rowsAffected:1};
    }
    throw new Error('Unexpected SQL: '+sql);
  }
};
const opts={
  filePath:'/data/bot-stats.json',
  url:'libsql://fake.example',
  authToken:'fake',
  fs:fakeFs,
  clientFactory:()=>db,
};
const original = createStatsPersistence({...opts,backend:'file'});
assert.deepEqual(await original.load(),initial);
assert.equal(dbWriteCount,0,'default backend must not touch Turso');

const mirror = createStatsPersistence({...opts,backend:'mirror'});
assert.deepEqual(await mirror.load(),initial);
assert.deepEqual(JSON.parse(snapshots.get('mediax-production')),initial,'mirror seeds snapshot');
assert.deepEqual(JSON.parse(backups.get('mediax-production')),initial,'original Railway snapshot backed up');

const after = structuredClone(initial);
after.users['100'].channelUseCount = 5;
after.monthlyDownloads['2026-10'] = 20;
await mirror.persist(after);
assert.deepEqual(JSON.parse(file),after,'Railway remains authoritative');
assert.deepEqual(JSON.parse(snapshots.get('mediax-production')),after,'Turso mirror updated');
assert.deepEqual(JSON.parse(backups.get('mediax-production')),initial,'seed backup must remain immutable');
const standby = createStatsPersistence({...opts,backend:'turso',seedFromFile:false});
assert.deepEqual(await standby.load(),after,'Render sees Railway usage and gate counter');
const updated = structuredClone(after);updated.users['100'].channelUseCount=6;
await standby.persist(updated);
assert.deepEqual(await standby.load(),updated,'Render can write when it takes over');
assert.deepEqual(JSON.parse(backups.get('mediax-production')),initial,'never alter seed backup on cutover');

failDatabase=true;
const another = structuredClone(after);another.monthlyDownloads['2026-10']=21;
await mirror.persist(another); // Turso outage must not prevent Railway usage.
assert.deepEqual(JSON.parse(file),another,'file remains writable when Turso fails');
failDatabase=false;
await mirror.load();
assert.deepEqual(JSON.parse(snapshots.get('mediax-production')),another,'Railway self-heals shadow copy');

file = null;
await assert.rejects(()=>mirror.load(),/refusing to mirror an empty snapshot/);
snapshots.clear();
await assert.rejects(()=>standby.load(),/missing in Turso/);
await assert.rejects(()=>standby.persist(updated),/missing during persist/);
snapshots.set('mediax-production','{"broken":true}');
await assert.rejects(()=>standby.load(),/invalid/);
console.log('MEDIAX_STATS_PERSISTENCE_SELFTEST_OK — immutable backup; Railway file authority; Turso mirror; outage handling; fail-closed Render; rollback-compatible');
