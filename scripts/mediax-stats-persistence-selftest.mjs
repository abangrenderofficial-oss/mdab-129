import assert from 'node:assert/strict';
import { createStatsPersistence } from '../src/bot/stats-persistence.js';

const initial = {
  version: 2, trackingSince: '2026-10-01T00:00:00.000Z',
  users: {'100': {channelUseCount: 4, completedUse: true}},
  monthlyDownloads: {'2026-10': 19},
};
let file = JSON.stringify(initial);
const fakeFs = {
  readFile: async () => file,
  mkdir: async () => {},
  writeFile: async (_path, content) => { fakeFs.pending = content; },
  rename: async () => { file = fakeFs.pending; },
};
const dbRows = new Map();
let operations = 0;
const db = {
  async execute(query) {
    const sql = typeof query === 'string' ? query : query.sql;
    const args = typeof query === 'string' ? [] : query.args;
    operations++;
    if (sql.startsWith('CREATE TABLE')) return {rows:[],rowsAffected:0};
    if (sql.startsWith('SELECT payload_json')) {
      const entry = dbRows.get(args[0]);
      return {rows: entry ? [{payload_json:entry}] : [],rowsAffected:0};
    }
    if (sql.startsWith('INSERT OR IGNORE')) {
      if (!dbRows.has(args[0])) dbRows.set(args[0],args[1]);
      return {rows:[],rowsAffected:1};
    }
    if (sql.startsWith('UPDATE mediax_statistics_snapshot')) {
      if (!dbRows.has(args[2])) return {rows:[],rowsAffected:0};
      dbRows.set(args[2],args[0]);
      return {rows:[],rowsAffected:1};
    }
    throw new Error('unexpected SQL: '+sql);
  },
};
const opts = {filePath:'/data/bot-stats.json',url:'libsql://fake.example',authToken:'dummy',fs:fakeFs,clientFactory:()=>db};
const originalFile = createStatsPersistence({...opts,backend:'file'});
assert.deepEqual(await originalFile.load(),initial);
const railwaySeed = createStatsPersistence({...opts,backend:'turso',seedFromFile:true});
assert.deepEqual(await railwaySeed.load(),initial);
assert.ok(dbRows.has('mediax-production'));
const renderCopy = createStatsPersistence({...opts,backend:'turso',seedFromFile:false});
assert.deepEqual(await renderCopy.load(),initial);
const after = structuredClone(initial);
after.users['100'].channelUseCount = 5;
after.monthlyDownloads['2026-10'] = 20;
await railwaySeed.persist(after);
assert.deepEqual(await renderCopy.load(),after);
assert.deepEqual(JSON.parse(file),after);
dbRows.clear();
await assert.rejects(()=>renderCopy.load(),/missing in Turso/);
await assert.rejects(()=>renderCopy.persist(after),/missing during persist/);
dbRows.set('mediax-production','{"invalid":true}');
await assert.rejects(()=>renderCopy.load(),/invalid/);
assert.ok(operations > 5);
console.log('MEDIAX_STATS_PERSISTENCE_SELFTEST_OK — Railway seed, Render parity, durable update, fail-closed missing/corrupt snapshot');
