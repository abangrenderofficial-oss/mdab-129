// Free + Share end to end on a throwaway local database, with Telegram mocked.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const dir=await mkdtemp(path.join(tmpdir(),'mediax-share-'));
Object.assign(process.env,{
 TURSO_DATABASE_URL:'file:'+path.join(dir,'t.db'),TURSO_AUTH_TOKEN:'local-selftest',BAYARCASH_SANDBOX:'true',
 PAYPING_SHARED_CONFIG_ENABLED:'true',TELEGRAM_BOT_TOKEN:'123:selftest',TELEGRAM_BOT_USERNAME:'MediaXTestBot',
 STATS_FILE_PATH:path.join(dir,'stats.json'),MEDIAX_STATS_BACKEND:'file',BOT_OWNER_ID:'999999999'
});
const sent=[];
globalThis.fetch=async(url,init={})=>{
 const method=String(url).split('/').pop(),body=JSON.parse(init.body||'{}');
 sent.push({method,...body});
 return new Response(JSON.stringify({ok:true,result:method==='getMe'?{username:'MediaXTestBot'}:{message_id:sent.length}}),{headers:{'content-type':'application/json'}});
};
const take=()=>sent.splice(0);

try{
 const {getSupportDb}=await import('../src/support/store.js');
 const db=await getSupportDb();
 const E='sandbox',t0=new Date(Date.now()-60000).toISOString();
 // Minimal PayPing-owned tables (PayPing creates the full versions in production).
 await db.batch([
  "CREATE TABLE IF NOT EXISTS payping_access_policies_v2(environment TEXT NOT NULL,bot_id TEXT NOT NULL,mode TEXT NOT NULL DEFAULT 'free',channel_id TEXT NOT NULL DEFAULT '',channel_after INTEGER NOT NULL DEFAULT 5,free_uses INTEGER NOT NULL DEFAULT 0,schedule_json TEXT NOT NULL DEFAULT '{}',override_mode TEXT NOT NULL DEFAULT '',override_until TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(environment,bot_id))",
  "CREATE TABLE IF NOT EXISTS payping_bots(environment TEXT NOT NULL,bot_id TEXT NOT NULL,name TEXT NOT NULL,PRIMARY KEY(environment,bot_id))",
  "CREATE TABLE IF NOT EXISTS payping_lock_replies_v1(environment TEXT NOT NULL,bot_id TEXT NOT NULL,mode TEXT NOT NULL,body TEXT NOT NULL,button_enabled INTEGER NOT NULL DEFAULT 1,button_label TEXT NOT NULL DEFAULT '',button_url TEXT NOT NULL DEFAULT '',PRIMARY KEY(environment,bot_id,mode))"
 ].map(sql=>({sql,args:[]})),'write');
 const share=await import('../src/support/payping-share.js');
 const gate=await import('../src/features/share-gate.js');
 await share.getMediaXShareRule({fresh:true}); // creates share tables
 await db.batch([
  {sql:"INSERT INTO payping_bots VALUES(?,?,?)",args:[E,'mediax','MediaX Downloader']},
  {sql:"INSERT INTO payping_access_policies_v2(environment,bot_id,mode) VALUES(?,?,?)",args:[E,'mediax','free_share']},
  {sql:"INSERT INTO payping_share_settings_v1(environment,bot_id,needed,after_uses,unlock_days,share_text,unlocked_text,joined_text,updated_at) VALUES(?,?,2,1,0,'Cuba {bot_name} 👇','Tahniah {first_name}, terbuka!','{friend_name} join! {invited}/{needed}',?)",args:[E,'mediax',t0]},
  {sql:"INSERT INTO payping_share_campaign_v1 VALUES(?,?,1,?)",args:[E,'mediax',t0]},
  {sql:"INSERT INTO payping_lock_replies_v1(environment,bot_id,mode,body,button_label) VALUES(?,?,?,?,?)",args:[E,'mediax','free_share','Hai {first_name}, {invited}/{needed}, tinggal {remaining}','📤 Share']}
 ].map(x=>x),'write');
 share.resetShareRuleCache();

 let n=100;
 const msg=(uid,first,text='https://vt.tiktok.com/abc/')=>({message_id:++n,chat:{id:uid,type:'private'},from:{id:uid,first_name:first},text});
 const A=111000111,B=222000222,C=333000333;

 // 1. First link is free; its delivery is one completed use.
 const a1=msg(A,'Aiman');
 assert.equal(await gate.enforceShareGateForMessage(a1),false,'first use is free');
 await gate.recordShareCompletedUse(A,`src:${A}:${a1.message_id}`);
 await gate.recordShareCompletedUse(A,`src:${A}:${a1.message_id}`); // retry is not a second use
 take();
 // HQ buttons are callbacks and plain chat text is not a new source: never locked.
 assert.equal(await gate.enforceShareGateForMessage(msg(A,'Aiman','terima kasih')),false);

 // 2. Second NEW source asks for a share.
 assert.equal(await gate.enforceShareGateForMessage(msg(A,'Aiman')),true,'second source is locked');
 let out=take(),lock=out.find(x=>x.method==='sendMessage');
 assert.equal(lock.chat_id,A);
 assert.equal(lock.text,'Hai Aiman, 0/2, tinggal 2\n\n⬜⬜');
 const [shareBtn]=lock.reply_markup.inline_keyboard[0],[checkBtn]=lock.reply_markup.inline_keyboard[1];
 assert.equal(shareBtn.text,'📤 Share');
 const shared=new URL(shareBtn.url);
 assert.equal(shared.origin+shared.pathname,'https://t.me/share/url');
 const link=shared.searchParams.get('url');
 assert.match(link,/^https:\/\/t\.me\/MediaXTestBot\?start=inv_[A-Z0-9]{7}$/);
 assert.equal(shared.searchParams.get('text'),'Cuba MediaX Downloader 👇');
 assert.equal(checkBtn.callback_data,share.SHARE_CHECK_CALLBACK);
 const payload=link.split('start=')[1].toLowerCase(); // Telegram router lowercases payloads

 // 3. Self-invites never count.
 assert.equal((await gate.handleShareStartPayload(msg(A,'Aiman','/start '+payload),payload)).reason,'SELF');

 // 4. A new friend joins, but counts only after their own first completed use.
 assert.equal((await gate.handleShareStartPayload(msg(B,'Ali','/start '+payload),payload)).reason,'RECORDED');
 assert.equal((await gate.handleShareStartPayload(msg(B,'Ali','/start '+payload),payload)).reason,'ALREADY_INVITED');
 assert.equal((await share.shareState(A,await share.getMediaXShareRule())).invited,0,'joining alone does not count');
 const b1=msg(B,'Ali');
 assert.equal(await gate.enforceShareGateForMessage(b1),false,'friend gets their own free use');
 take();
 await gate.recordShareCompletedUse(B,`src:${B}:${b1.message_id}`);
 out=take();
 assert.deepEqual(out.map(x=>[x.method,x.chat_id,x.text]),[['sendMessage',A,'Ali join! 1/2']],'inviter hears about progress');

 // 5. Progress button shows 1/2 and refreshes the lock message.
 await gate.processShareGateCallback({id:'cb1',data:share.SHARE_CHECK_CALLBACK,from:{id:A,first_name:'Aiman'},message:{message_id:5,chat:{id:A}}});
 out=take();
 assert.match(out.find(x=>x.method==='answerCallbackQuery').text,/^Progress: 1\/2 · tinggal 1 kawan lagi/);
 assert.equal(out.find(x=>x.method==='editMessageText').text,'Hai Aiman, 1/2, tinggal 1\n\n🟩⬜');
 assert.equal(await gate.enforceShareGateForMessage(msg(A,'Aiman')),true,'still locked at 1/2');
 take();

 // 6. Existing users never count, even through a valid link.
 const old=444000444,o1=msg(old,'Lama');
 await gate.enforceShareGateForMessage(o1);await gate.recordShareCompletedUse(old,`src:${old}:${o1.message_id}`);
 assert.equal((await gate.handleShareStartPayload(msg(old,'Lama','/start '+payload),payload)).reason,'EXISTING_USER');

 // 7. Second friend completes → inviter unlocked and told so.
 assert.equal((await gate.handleShareStartPayload(msg(C,'Siti','/start '+payload),payload)).reason,'RECORDED');
 const c1=msg(C,'Siti');await gate.enforceShareGateForMessage(c1);take();
 await gate.recordShareCompletedUse(C,`src:${C}:${c1.message_id}`);
 out=take();
 assert.deepEqual(out.map(x=>[x.chat_id,x.text]),[[A,'Tahniah awak, terbuka!']]);
 assert.equal(await gate.enforceShareGateForMessage(msg(A,'Aiman')),false,'unlocked forever');
 assert.equal(take().length,0);

 // 8. Timing: with 2 free uses, the third new source is the first one locked.
 await db.execute({sql:"UPDATE payping_share_settings_v1 SET after_uses=2,unlock_days=7",args:[]});
 share.resetShareRuleCache();
 const D=555000555;
 for(let i=0;i<2;i++){const m=msg(D,'Dan');assert.equal(await gate.enforceShareGateForMessage(m),false,'use '+(i+1)+' is free');await gate.recordShareCompletedUse(D,`src:${D}:${m.message_id}`)}
 take();
 assert.equal(await gate.enforceShareGateForMessage(msg(D,'Dan')),true,'third source locked');take();

 // 9. A 7-day unlock expires; new friends are needed again.
 await share.unlockShare(D,await share.getMediaXShareRule());
 assert.equal(await gate.enforceShareGateForMessage(msg(D,'Dan')),false);
 await db.execute({sql:"UPDATE payping_share_unlocks_v1 SET expires_at=? WHERE telegram_user_id=?",args:[new Date(Date.now()-1000).toISOString(),String(D)]});
 assert.equal(await gate.enforceShareGateForMessage(msg(D,'Dan')),true,'locked again after expiry');take();

 // 9b. Original-quality photo and video documents are new sources too; other files are not.
 const doc=(document)=>({message_id:++n,chat:{id:D,type:'private'},from:{id:D,first_name:'Dan'},document});
 assert.equal(await gate.enforceShareGateForMessage(doc({file_id:'img1',mime_type:'image/png',file_name:'a.png'})),true,'image document locked');take();
 assert.equal(await gate.enforceShareGateForMessage(doc({file_id:'vid1',mime_type:'video/mp4',file_name:'a.mp4'})),true,'video document locked');take();
 assert.equal(await gate.enforceShareGateForMessage(doc({file_id:'pdf1',mime_type:'application/pdf',file_name:'a.pdf'})),false,'other files are not a source');

 // 10. Groups, the owner and other modes are never share-locked.
 assert.equal(await gate.enforceShareGateForMessage({...msg(D,'Dan'),chat:{id:-100123,type:'supergroup'}}),false);
 assert.equal(await gate.enforceShareGateForMessage(msg(999999999,'Owner')),false);
 await db.execute({sql:"UPDATE payping_access_policies_v2 SET mode='free_channel'",args:[]});share.resetShareRuleCache();
 assert.equal(await gate.enforceShareGateForMessage(msg(D,'Dan')),false,'other modes ignore share state');
 const before=(await db.execute("SELECT COUNT(*) n FROM payping_share_sessions_v1")).rows[0].n;
 await gate.recordShareCompletedUse(D,'src:x:1');
 assert.equal((await db.execute("SELECT COUNT(*) n FROM payping_share_sessions_v1")).rows[0].n,before,'uses are not counted outside Free + Share');

 // 11. Database trouble never locks anyone out.
 await db.execute({sql:"UPDATE payping_access_policies_v2 SET mode='free_share'",args:[]});share.resetShareRuleCache();
 await db.execute("DROP TABLE payping_share_sessions_v1");
 assert.equal(await gate.enforceShareGateForMessage(msg(D,'Dan')),false,'fails open');

 console.log('PAYPING_SHARE_GATE_SELFTEST_OK — free uses, second-source lock, invite link + share sheet, friend counted after own use, notices, unlock, expiry, fail-open, original documents');
}finally{
 await rm(dir,{recursive:true,force:true});
}
