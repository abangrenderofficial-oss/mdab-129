import { spawn } from 'node:child_process';

const port = 39871;
const child = spawn(process.execPath, ['server.js'], {
  env: {
    ...process.env,
    PORT: String(port),
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_WEBHOOK_SECRET: '',
    BAYARCASH_API_TOKEN: '',
    BAYARCASH_API_SECRET_KEY: '',
    BAYARCASH_PORTAL_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += String(chunk); });
child.stderr.on('data', (chunk) => { stderr += String(chunk); });

async function waitFor(url) {
  let lastError = null;
  for (let i = 0; i < 30; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError || new Error('server_not_ready');
}

try {
  const root = await waitFor(`http://127.0.0.1:${port}/`);
  const rootJson = await root.json();
  if (rootJson?.service !== 'telegram-social-downloader') {
    throw new Error('Railway/Node root router returned unexpected service.');
  }

  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  if (!health.ok) throw new Error(`Health endpoint HTTP ${health.status}`);
  const healthJson = await health.json();
  if (healthJson?.runtime !== 'node') {
    throw new Error(`Expected node runtime, got ${healthJson?.runtime}`);
  }

  console.log('DUAL_RUNTIME_NODE_SMOKE_OK', JSON.stringify({
    rootRuntime: rootJson.runtime,
    healthRuntime: healthJson.runtime,
    heavyMediaRuntime: healthJson.heavyMediaRuntime,
    databaseRuntime: healthJson.databaseRuntime,
  }));
} catch (error) {
  console.error('DUAL_RUNTIME_NODE_SMOKE_FAILED', error?.message || error);
  console.error(stdout.slice(-4000));
  console.error(stderr.slice(-4000));
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
