import { createClient } from '@libsql/client';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * MediaX statistics storage.
 *
 * file (default): original Railway behaviour; no production changes.
 * mirror: Railway local file remains authoritative; shadow-copy snapshots to Turso.
 * turso: durable shared storage for a controlled Railway -> Render migration.
 * Only Railway may seed Turso using the local /data file; Render must NEVER
 * bootstrap a missing record to an empty state.
 */
export function createStatsPersistence({
  filePath,
  backend = process.env.MEDIAX_STATS_BACKEND || 'file',
  seedFromFile = process.env.MEDIAX_STATS_SEED_FROM_FILE === '1',
  namespace = process.env.MEDIAX_STATS_NAMESPACE || 'mediax-production',
  url = process.env.TURSO_DATABASE_URL || '',
  authToken = process.env.TURSO_AUTH_TOKEN || '',
  clientFactory = createClient,
  fs = { mkdir, readFile, rename, writeFile },
} = {}) {
  if (!filePath) throw new Error('Stats filePath is required');
  if (!['file', 'mirror', 'turso'].includes(backend)) throw new Error('Invalid MEDIAX_STATS_BACKEND');
  if (backend !== 'file' && (!url || !authToken)) throw new Error('Turso statistics ENV is missing');
  if (backend === 'turso' && seedFromFile && process.env.MEDIAX_MODE === 'active') {
    throw new Error('Seeding from Render active runtime is forbidden');
  }

  let db;
  let schemaPromise;
  function getDb() {
    if (!db) db = clientFactory({ url, authToken });
    return db;
  }
  async function ensureSchema() {
    if (!schemaPromise) {
      schemaPromise = getDb().execute(`CREATE TABLE IF NOT EXISTS mediax_statistics_snapshot (
        namespace TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`).catch((err) => { schemaPromise = null; throw err; });
    }
    await schemaPromise;
    return getDb();
  }
  async function readLocal() {
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }
  async function writeLocal(state) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(state)}\n`, 'utf8');
    await fs.rename(temp, filePath);
  }
  function validate(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || !raw.users || typeof raw.users !== 'object' || Array.isArray(raw.users)
        || !raw.monthlyDownloads || typeof raw.monthlyDownloads !== 'object'
        || Array.isArray(raw.monthlyDownloads)) {
      throw new Error('Stats snapshot is invalid; refusing to reset usage counters');
    }
    return raw;
  }
  async function shadowSync(state) {
    const c = await ensureSchema();
    // First-run immutable backup for rollback if the primary file changes.
    await c.execute(`CREATE TABLE IF NOT EXISTS mediax_statistics_seed_backup (
      namespace TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      saved_at TEXT NOT NULL
    )`);
    const now = new Date().toISOString();
    const value = JSON.stringify(validate(state));
    await c.execute({
      sql: 'INSERT OR IGNORE INTO mediax_statistics_seed_backup(namespace, payload_json, saved_at) VALUES (?, ?, ?)',
      args: [namespace, value, now],
    });
    await c.execute({
      sql: `INSERT INTO mediax_statistics_snapshot(namespace, payload_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(namespace) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
      args: [namespace, value, now],
    });
  }
  async function load() {
    if (backend === 'file') return readLocal();
    if (backend === 'mirror') {
      const local = await readLocal();
      if (!local) throw new Error('Railway statistics file missing; refusing to mirror an empty snapshot');
      validate(local);
      try { await shadowSync(local); }
      catch (error) { console.warn('[stats] mirror sync unavailable:', error?.message); }
      return local;
    }
    const c = await ensureSchema();
    const get = () => c.execute({
      sql: 'SELECT payload_json FROM mediax_statistics_snapshot WHERE namespace = ?',
      args: [namespace],
    });
    let result = await get();
    if (!result.rows.length) {
      if (!seedFromFile) {
        throw new Error('Stats snapshot is missing in Turso; seed from Railway /data first');
      }
      const local = await readLocal();
      if (!local) throw new Error('Railway local statistics file missing; cannot seed Turso');
      validate(local);
      await c.execute({
        sql: 'INSERT OR IGNORE INTO mediax_statistics_snapshot(namespace, payload_json, updated_at) VALUES (?, ?, ?)',
        args: [namespace, JSON.stringify(local), new Date().toISOString()],
      });
      result = await get();
    }
    if (!result.rows.length) throw new Error('Turso stats snapshot still missing after seed');
    return validate(JSON.parse(String(result.rows[0].payload_json)));
  }
  async function persist(state) {
    validate(state);
    if (backend === 'file') return writeLocal(state);
    if (backend === 'mirror') {
      await writeLocal(state); // Railway writes stay authoritative even if Turso fails.
      try { await shadowSync(state); }
      catch (error) { console.warn('[stats] mirror sync unavailable:', error?.message); }
      return;
    }
    const c = await ensureSchema();
    await c.execute({
      sql: `UPDATE mediax_statistics_snapshot
        SET payload_json = ?, updated_at = ?
        WHERE namespace = ?`,
      args: [JSON.stringify(state), new Date().toISOString(), namespace],
    }).then((result) => {
      if (result.rowsAffected !== 1) throw new Error('Turso stats snapshot missing during persist');
    });
    // Railway may retain a local mirror. The remote transaction is authoritative.
    if (seedFromFile) {
      try { await writeLocal(state); } catch (e) { console.warn('[stats] local mirror failed:', e?.message); }
    }
  }
  return { load, persist, backend };
}
