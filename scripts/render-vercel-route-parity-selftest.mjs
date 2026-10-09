import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Read-only route contract audit. Do not boot server.js: booting it starts
// Telegram schedulers and monitoring jobs, even when no webhook is registered.
const vercel = JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
const renderCode = await readFile(new URL('../server.js',import.meta.url),'utf8');
const vercelRouter = await readFile(new URL('../api/router.js',import.meta.url),'utf8');
const renderPaths = Array.from(renderCode.matchAll(/\[\s*['"](\/[^'"]+)['"]\s*,\s*([A-Za-z0-9_]+)/g),m=>[m[1],m[2]]);
const renderMap = new Map(renderPaths);
const vercelRouteHandlers = new Map(Array.from(
  vercelRouter.matchAll(/\['([^']+)',\s*([A-Za-z0-9_]+)\]/g),
  m=>[m[1],m[2]],
));
const rewritten = vercel.rewrites.map(r=>({
  source:r.source,
  route:new URL(r.destination,'https://internal.example').searchParams.get('route'),
}));
const missing=rewritten.filter(r=>r.source!=='/' && !renderMap.has(r.source));
const wrongHandlers=rewritten.filter(r=>r.source!=='/' && renderMap.has(r.source) &&
  vercelRouteHandlers.has(r.route) && renderMap.get(r.source)!==vercelRouteHandlers.get(r.route));
const duplicate=renderPaths.filter(([p],i)=>renderPaths.findIndex(([q])=>q===p)!==i).map(x=>x[0]);
assert.deepEqual(missing,[],'Render must implement every Vercel rewrite');
assert.deepEqual(wrongHandlers,[],'Render route handlers must match Vercel router');
assert.deepEqual(duplicate,[],'Render has duplicate paths');
for(const route of ['/api/payping-bot-admin','/api/heavy-limit','/ar-payment/bots/add','/ar-payment/bots/add/']){
  assert.ok(renderMap.has(route),'PayPing admin route missing: '+route);
}
const requiredApiRoutes=['/api/payping-bot-admin','/api/payping-data','/api/payping-settings',
  '/api/payment-push','/api/payping-auth','/api/bayarcash','/api/affiliate-web','/api/affiliate-admin'];
for(const route of requiredApiRoutes)assert.ok(renderMap.has(route),'Required API missing: '+route);
console.log('MEDIAX_VERCEL_RENDER_ROUTE_PARITY_OK',JSON.stringify({
  vercelRewrites:rewritten.length,
  renderRoutes:renderPaths.length,
  unmapped:missing.length,
  mismatched:wrongHandlers.length,
  duplicates:duplicate.length,
  status:'source parity only; live E2E and ENV/callback migrations unverified',
}));
