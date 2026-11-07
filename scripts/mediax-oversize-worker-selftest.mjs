import assert from 'node:assert/strict';
import {requiresOversizeTikTokWorker,dispatchOversizeTikTokWorker} from '../src/tiktok-oversize-worker.js';
assert.equal(requiresOversizeTikTokWorker([{filesize:448073600}],50*1024*1024),true);
assert.equal(requiresOversizeTikTokWorker([{filesize:12000000}],50*1024*1024),false);
assert.equal(requiresOversizeTikTokWorker([{filesize:448073600},{filesize:15000000}],50*1024*1024),false);
assert.equal(requiresOversizeTikTokWorker([{filesize:448073600},{filesize:0}],50*1024*1024),false);
const before={token:process.env.GITHUB_ACTIONS_TOKEN,base:process.env.PUBLIC_BASE_URL};
process.env.GITHUB_ACTIONS_TOKEN='test-only';
process.env.PUBLIC_BASE_URL='https://test.apps.bot-hosting.cloud';
const originalFetch=globalThis.fetch;
let payload;
globalThis.fetch=async(_url,init)=>{payload=JSON.parse(init.body);return new Response(null,{status:204})};
try{
  assert.equal((await dispatchOversizeTikTokWorker({chatId:'6749355196',sourceUrl:'https://vt.tiktok.com/ZSphJKLNf/'})).dispatched,true);
  assert.equal(payload.ref,'main');
  assert.equal(payload.inputs.chat_id,'6749355196');
  assert.equal(payload.inputs.source_url,'https://vt.tiktok.com/ZSphJKLNf/');
  assert.match(payload.inputs.stream_url,/^https:\/\/test\.apps\.bot-hosting\.cloud\/api\/oversize-tiktok-source\?ticket=[a-f0-9]{48}$/);
  await assert.rejects(dispatchOversizeTikTokWorker({chatId:'6749355196',sourceUrl:'https://evil.example/' }),/TikTok links only/);
  console.log('MEDIAX_OVERSIZE_WORKER_SELFTEST_OK — large-only handoff, signed stream, normal videos untouched');
}finally{
  globalThis.fetch=originalFetch;
  if(before.token===undefined)delete process.env.GITHUB_ACTIONS_TOKEN;else process.env.GITHUB_ACTIONS_TOKEN=before.token;
  if(before.base===undefined)delete process.env.PUBLIC_BASE_URL;else process.env.PUBLIC_BASE_URL=before.base;
}
