import assert from 'node:assert/strict';
import { decideStatusHqOffload } from '../src/render/hq-offload-policy.js';
import { dispatchHeavyMediaJob } from '../src/heavy-worker-dispatch.js';

// No Telegram calls and no real GitHub API calls occur in this test.
assert.deepEqual(decideStatusHqOffload({mode:'standby',videoFileId:'fileX'}).offload,false);
assert.deepEqual(decideStatusHqOffload({mode:'',videoFileId:'fileX'}).offload,false);
assert.equal(decideStatusHqOffload({mode:'',gallery:true,galleryHeavyCandidate:true,videoFileId:'fileX'}).offload,true);
assert.equal(decideStatusHqOffload({mode:'active',videoFileId:'fileX'}).offload,true);
assert.equal(decideStatusHqOffload({mode:'active',gallery:true,videoFileId:'fileX'}).offload,true);
assert.equal(decideStatusHqOffload({mode:'active',isImage:true,videoFileId:'photo'}).offload,false);
assert.equal(decideStatusHqOffload({mode:'active'}).requiresVideo,true);
assert.equal(decideStatusHqOffload({mode:'active',videoFileId:'fileX',fileSize:205*1024*1024}).oversized,true);
assert.equal(decideStatusHqOffload({mode:'active',videoFileId:'fileX',fileSize:100*1024*1024}).offload,true);

const oldFetch=globalThis.fetch;
const originalMode=process.env.MEDIAX_MODE;
const originalToken=process.env.GITHUB_ACTIONS_TOKEN;
const originalRef=process.env.GITHUB_WORKER_REF;
let calls=0;
try {
  process.env.MEDIAX_MODE='active';
  process.env.GITHUB_ACTIONS_TOKEN='fake-token-for-dry-run-only';
  delete process.env.GITHUB_WORKER_REF;
  globalThis.fetch=async(url,opts)=>{
    calls++;
    assert.equal(url,'https://api.github.com/repos/abangrenderofficial-oss/mdab-129/actions/workflows/heavy-status-hq.yml/dispatches');
    assert.equal(opts.method,'POST');
    assert.equal(opts.headers.Authorization,'Bearer fake-token-for-dry-run-only');
    const payload=JSON.parse(opts.body);
    assert.equal(payload.ref,'infra/mediax-render-standby');
    assert.equal(payload.inputs.action,'status_hq');
    assert.equal(payload.inputs.source_kind,'link');
    assert.equal(payload.inputs.video_file_id,'tg-fileid-123');
    assert.equal(payload.inputs.user_id,'555');
    assert.equal(payload.inputs.chat_id,'555');
    assert.equal(payload.inputs.completion_callback_url,'https://mediax-railway-backup.onrender.com/api/premium-hq-success');
    return {status:204};
  };
  const result=await dispatchHeavyMediaJob({
    chatId:555,userId:555,videoFileId:'tg-fileid-123',fileSize:9*1024*1024,
    action:'status_hq',sourceKind:'link',progressMessageId:11,sourceMessageId:10,
    completionCallbackUrl:'https://mediax-railway-backup.onrender.com/api/premium-hq-success',
  });
  assert.equal(result,true);
  assert.equal(calls,1);
  process.env.MEDIAX_MODE='standby';
  globalThis.fetch=async(_url,opts)=>{
    calls++;
    const payload=JSON.parse(opts.body);
    assert.equal(payload.ref,'main');
    assert.equal(payload.inputs.source_kind,'gallery');
    return {status:204};
  };
  await dispatchHeavyMediaJob({
    chatId:555,userId:555,videoFileId:'tg-gallery-id',
    action:'status_hq',sourceKind:'gallery',
  });
  assert.equal(calls,2);
  console.log('RENDER_HQ_ROUTING_SELFTEST_OK — active Render offloads link video, backup worker ref, Railway legacy behavior and no remote calls');
} finally {
  globalThis.fetch=oldFetch;
  if (originalMode===undefined) delete process.env.MEDIAX_MODE; else process.env.MEDIAX_MODE=originalMode;
  if (originalToken===undefined) delete process.env.GITHUB_ACTIONS_TOKEN; else process.env.GITHUB_ACTIONS_TOKEN=originalToken;
  if (originalRef===undefined) delete process.env.GITHUB_WORKER_REF; else process.env.GITHUB_WORKER_REF=originalRef;
}
