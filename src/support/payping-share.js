// Free + Share for MediaX. PayPing owns the settings; this runtime applies the
// same rules on the same tables (see PayPing src/share-access.js).
// Telegram cannot confirm a share, so progress counts NEW people who open the
// bot through the user's personal link (?start=inv_CODE) and then complete
// their own first use. One completed use = one new link or upload whose media
// was delivered; that session's Premium + HQ / Android HQ stays part of it.
import {currentSupportEnvironment,getSupportDb} from './store.js';
import {isPayPingSharedConfigEnabled} from './payping-shared-config.js';
// Same safe formatter as PayPing: values are escaped; only <b>, <i>, <u>, <strong>, <em> survive.
const escapeHtml=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function formatPayPingMessage(template,values={}){
 const body=String(template||'').replace(/\\n/g,'\n');
 const safe=body.replace(/\{([a-z_]+)\}/g,(_,key)=>'\u0001'+encodeURIComponent(escapeHtml(values[key]??''))+'\u0002');
 let out=escapeHtml(safe).replace(/&lt;(\/?)(b|i|strong|em|u)&gt;/gi,(_,closing,tag)=>'<'+closing+tag.toLowerCase()+'>');
 out=out.replace(/\u0001([\s\S]*?)\u0002/g,(_,token)=>decodeURIComponent(token));
 return out.slice(0,3900);
}

export const SHARE_CHECK_CALLBACK='share:check:v1';
export const SHARE_DEFAULTS=Object.freeze({
 needed:3,afterUses:1,unlockDays:0,
 body:'Hai {first_name}! 👋\\nNak terus guna {bot_name}? Jemput <b>{needed}</b> kawan baru guna link awak.\\n\\nProgress: {invited}/{needed} · tinggal {remaining} lagi 🎯',
 buttonLabel:'📤 Share ke Kawan',
 shareText:'Aku guna {bot_name}, free! Cuba 👇',
 unlockedText:'🎉 Terima kasih {first_name}! {needed} kawan dah join. Awak boleh guna {bot_name} macam biasa.',
 joinedText:'✅ {friend_name} baru join guna link awak! Progress: {invited}/{needed}'
});
const DDL=[
  "CREATE TABLE IF NOT EXISTS payping_share_settings_v1(environment TEXT NOT NULL,bot_id TEXT NOT NULL,needed INTEGER NOT NULL DEFAULT 3,after_uses INTEGER NOT NULL DEFAULT 1,unlock_days INTEGER NOT NULL DEFAULT 0,share_text TEXT NOT NULL DEFAULT '',unlocked_text TEXT NOT NULL DEFAULT '',joined_text TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,PRIMARY KEY(environment,bot_id))",
  "CREATE TABLE IF NOT EXISTS payping_share_campaign_v1(environment TEXT NOT NULL,bot_id TEXT NOT NULL,campaign_seq INTEGER NOT NULL,activated_at TEXT NOT NULL,PRIMARY KEY(environment,bot_id))",
  "CREATE TABLE IF NOT EXISTS payping_share_codes_v1(environment TEXT NOT NULL,bot_id TEXT NOT NULL,telegram_user_id TEXT NOT NULL,code TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(environment,bot_id,telegram_user_id),UNIQUE(environment,bot_id,code))",
  "CREATE TABLE IF NOT EXISTS payping_share_invites_v1(environment TEXT NOT NULL,bot_id TEXT NOT NULL,invitee_id TEXT NOT NULL,inviter_id TEXT NOT NULL,invitee_name TEXT NOT NULL DEFAULT '',joined_at TEXT NOT NULL,counted_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(environment,bot_id,invitee_id))",
  "CREATE INDEX IF NOT EXISTS idx_share_invites_inviter ON payping_share_invites_v1(environment,bot_id,inviter_id,counted_at)",
  "CREATE TABLE IF NOT EXISTS payping_share_sessions_v1(environment TEXT NOT NULL,bot_id TEXT NOT NULL,campaign_seq INTEGER NOT NULL,telegram_user_id TEXT NOT NULL,session_key TEXT NOT NULL,started_at TEXT NOT NULL,PRIMARY KEY(environment,bot_id,campaign_seq,telegram_user_id,session_key))",
  "CREATE TABLE IF NOT EXISTS payping_share_unlocks_v1(environment TEXT NOT NULL,bot_id TEXT NOT NULL,campaign_seq INTEGER NOT NULL,telegram_user_id TEXT NOT NULL,unlocked_at TEXT NOT NULL,expires_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(environment,bot_id,campaign_seq,telegram_user_id,unlocked_at))"
];
const env=()=>currentSupportEnvironment();
const nowIso=()=>new Date().toISOString();
const validId=v=>{const n=Number(v);return Number.isSafeInteger(n)&&n>0?String(n):''};
const one=async(db,sql,args=[])=>(await db.execute({sql,args})).rows?.[0];

let tablesReady=null;
async function shareDb(){
 const db=await getSupportDb();
 if(!tablesReady)tablesReady=db.batch(DDL.map(sql=>({sql,args:[]})),'write').catch(e=>{tablesReady=null;throw e});
 await tablesReady;
 return db;
}

let ruleCache={checked:0,value:null};
/** Active rule, or null when MediaX is not in Free + Share (or PayPing is unreachable). */
export async function getMediaXShareRule({fresh=false}={}){
 if(!isPayPingSharedConfigEnabled())return null;
 if(!fresh&&Date.now()-ruleCache.checked<10000)return ruleCache.value;
 try{
  const db=await shareDb();
  const p=await one(db,"SELECT mode FROM payping_access_policies_v2 WHERE environment=? AND bot_id='mediax' LIMIT 1",[env()]);
  let value=null;
  if(String(p?.mode||'')==='free_share'){
   const [s,c]=await Promise.all([
    one(db,"SELECT needed,after_uses,unlock_days,share_text,unlocked_text,joined_text FROM payping_share_settings_v1 WHERE environment=? AND bot_id='mediax'",[env()]),
    one(db,"SELECT campaign_seq,activated_at FROM payping_share_campaign_v1 WHERE environment=? AND bot_id='mediax'",[env()])
   ]);
   // Like Free + Channel, never lock anyone without a deliberately started round.
   if(c&&Number(c.campaign_seq)>=1)value={
    campaignSeq:Number(c.campaign_seq),activatedAt:String(c.activated_at),
    needed:Math.min(20,Math.max(1,Number(s?.needed??SHARE_DEFAULTS.needed))),
    afterUses:Math.min(10,Math.max(1,Number(s?.after_uses??SHARE_DEFAULTS.afterUses))),
    unlockDays:[0,7,30].includes(Number(s?.unlock_days))?Number(s.unlock_days):0,
    shareText:String(s?.share_text||SHARE_DEFAULTS.shareText),
    unlockedText:String(s?.unlocked_text||SHARE_DEFAULTS.unlockedText),
    joinedText:String(s?.joined_text||SHARE_DEFAULTS.joinedText)};
  }
  ruleCache={checked:Date.now(),value};
 }catch(e){
  console.warn('[payping-share] rule lookup failed; keeping previous rule:',String(e?.message||e).slice(0,160));
  ruleCache.checked=Date.now();
 }
 return ruleCache.value;
}
export function resetShareRuleCache(){ruleCache={checked:0,value:null}}

/** Same rules as PayPing shareState(). */
export async function shareState(userId,rule){
 const uid=validId(userId);if(!uid||!rule)return null;
 const db=await shareDb(),t=nowIso();
 const [s,last]=await Promise.all([
  one(db,"SELECT COUNT(*) n FROM payping_share_sessions_v1 WHERE environment=? AND bot_id='mediax' AND campaign_seq=? AND telegram_user_id=?",[env(),rule.campaignSeq,uid]),
  one(db,"SELECT unlocked_at,expires_at FROM payping_share_unlocks_v1 WHERE environment=? AND bot_id='mediax' AND campaign_seq=? AND telegram_user_id=? ORDER BY unlocked_at DESC LIMIT 1",[env(),rule.campaignSeq,uid])
 ]);
 const unlocked=Boolean(last&&(!last.expires_at||String(last.expires_at)>t));
 const since=last?String(last.unlocked_at):rule.activatedAt;
 const inv=await one(db,"SELECT COUNT(*) n FROM payping_share_invites_v1 WHERE environment=? AND bot_id='mediax' AND inviter_id=? AND counted_at<>'' AND counted_at>=?",[env(),uid,since]);
 const sessions=Number(s?.n||0),invited=Math.min(rule.needed,Number(inv?.n||0));
 return {sessions,invited,unlocked,remaining:Math.max(0,rule.needed-invited),
  needsShare:!unlocked&&sessions>=rule.afterUses&&invited<rule.needed,
  canUnlock:!unlocked&&invited>=rule.needed};
}
export async function unlockShare(userId,rule){
 const db=await shareDb(),t=nowIso(),expires=rule.unlockDays?new Date(Date.now()+rule.unlockDays*86400000).toISOString():'';
 await db.execute({sql:"INSERT OR IGNORE INTO payping_share_unlocks_v1(environment,bot_id,campaign_seq,telegram_user_id,unlocked_at,expires_at) VALUES(?,'mediax',?,?,?,?)",args:[env(),rule.campaignSeq,validId(userId),t,expires]});
 return {unlockedAt:t,expiresAt:expires};
}

const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode=(n=7)=>[...crypto.getRandomValues(new Uint8Array(n))].map(x=>ALPHABET[x%ALPHABET.length]).join('');
export async function inviteCode(userId){
 const uid=validId(userId);if(!uid)return '';
 const db=await shareDb();
 for(let i=0;i<5;i++){
  const found=await one(db,"SELECT code FROM payping_share_codes_v1 WHERE environment=? AND bot_id='mediax' AND telegram_user_id=?",[env(),uid]);
  if(found)return String(found.code);
  await db.execute({sql:"INSERT OR IGNORE INTO payping_share_codes_v1(environment,bot_id,telegram_user_id,code,created_at) VALUES(?,'mediax',?,?,?)",args:[env(),uid,randomCode(),nowIso()]});
 }
 return '';
}
export const progressLine=(invited,needed)=>{const n=Number(needed)||0,i=Math.max(0,Math.min(n,Number(invited)||0));return n>=1&&n<=10?'🟩'.repeat(i)+'⬜'.repeat(n-i):''};
export const shareUrl=(link,text)=>'https://t.me/share/url?url='+encodeURIComponent(link)+'&text='+encodeURIComponent(text);
const plain=html=>String(html).replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');

async function botName(db){return String((await one(db,"SELECT name FROM payping_bots WHERE environment=? AND bot_id='mediax' LIMIT 1",[env()]))?.name||'MediaX Downloader')}

/** Lock message + keyboard (Share opens Telegram's share sheet; Check re-reads progress). */
export async function shareLockMessage(person={},rule,state,inviteLink){
 const db=await shareDb();
 const [copy,name]=await Promise.all([
  one(db,"SELECT body,button_label FROM payping_lock_replies_v1 WHERE environment=? AND bot_id='mediax' AND mode='free_share' LIMIT 1",[env()]).catch(()=>null),
  botName(db)
 ]);
 const vars={first_name:String(person.first_name||'awak').slice(0,80),username:person.username?'@'+String(person.username).replace(/^@/,'').slice(0,70):'',bot_name:name,
  invited:String(state.invited),needed:String(rule.needed),remaining:String(state.remaining),invite_link:inviteLink};
 const bar=progressLine(state.invited,rule.needed);
 const text=formatPayPingMessage(copy?.body||SHARE_DEFAULTS.body,vars)+(bar?'\n\n'+bar:'');
 const shareText=plain(formatPayPingMessage(rule.shareText,{first_name:vars.first_name,bot_name:name}));
 const rows=[];
 if(inviteLink)rows.push([{text:String(copy?.button_label||SHARE_DEFAULTS.buttonLabel).slice(0,64),url:shareUrl(inviteLink,shareText)}]);
 rows.push([{text:'🔄 Semak Progress',callback_data:SHARE_CHECK_CALLBACK}]);
 return {text,extra:{parse_mode:'HTML',disable_web_page_preview:true,reply_markup:{inline_keyboard:rows}}};
}
export async function shareNoticeText(kind,rule,{firstName='awak',friendName='',invited=0}={}){
 const db=await shareDb(),name=await botName(db);
 const vars={first_name:String(firstName||'awak'),friend_name:String(friendName||'Seorang kawan'),bot_name:name,invited:String(invited),needed:String(rule.needed),remaining:String(Math.max(0,rule.needed-invited))};
 return formatPayPingMessage(kind==='unlocked'?rule.unlockedText:rule.joinedText,vars);
}

/**
 * /start inv_CODE. A person counts once per bot, only if they have never used
 * MediaX before (knownUser comes from the bot's own history), never for themselves.
 */
export async function recordShareInviteJoin({inviteeId,code,inviteeName='',knownUser=false}){
 const invitee=validId(inviteeId),c=String(code||'').trim().toUpperCase().replace(/^INV_/,'');
 if(!invitee||!/^[A-Z0-9]{4,12}$/.test(c))return {recorded:false,reason:'INVALID'};
 const db=await shareDb();
 const inviter=(await one(db,"SELECT telegram_user_id FROM payping_share_codes_v1 WHERE environment=? AND bot_id='mediax' AND code=?",[env(),c]))?.telegram_user_id;
 if(!inviter)return {recorded:false,reason:'UNKNOWN_CODE'};
 if(String(inviter)===invitee)return {recorded:false,reason:'SELF'};
 if(knownUser)return {recorded:false,reason:'EXISTING_USER'};
 const seen=await one(db,"SELECT 1 x FROM payping_share_sessions_v1 WHERE environment=? AND bot_id='mediax' AND telegram_user_id=? UNION ALL SELECT 1 FROM payping_share_codes_v1 WHERE environment=? AND bot_id='mediax' AND telegram_user_id=? LIMIT 1",[env(),invitee,env(),invitee]);
 if(seen)return {recorded:false,reason:'EXISTING_USER'};
 const r=await db.execute({sql:"INSERT OR IGNORE INTO payping_share_invites_v1(environment,bot_id,invitee_id,inviter_id,invitee_name,joined_at) VALUES(?,'mediax',?,?,?,?)",args:[env(),invitee,String(inviter),String(inviteeName||'').trim().slice(0,60),nowIso()]});
 const ok=Number(r.rowsAffected||0)===1;
 return {recorded:ok,reason:ok?'RECORDED':'ALREADY_INVITED',inviterId:String(inviter)};
}

/**
 * One completed use: counts toward the user's own free uses (only while Free + Share
 * is on) and, if they joined through an invite, moves the inviter's progress.
 * sessionKey (e.g. chat:message of the link/upload) keeps retries idempotent.
 */
export async function recordShareUse(userId,sessionKey,{notify}={}){
 const uid=validId(userId);if(!uid||!isPayPingSharedConfigEnabled())return {session:false,invite:null};
 const rule=await getMediaXShareRule();
 const db=await shareDb();
 let session=false;
 if(rule&&sessionKey){
  const r=await db.execute({sql:"INSERT OR IGNORE INTO payping_share_sessions_v1(environment,bot_id,campaign_seq,telegram_user_id,session_key,started_at) VALUES(?,'mediax',?,?,?,?)",args:[env(),rule.campaignSeq,uid,String(sessionKey).slice(0,120),nowIso()]});
  session=Number(r.rowsAffected||0)===1;
 }
 const t=nowIso();
 const counted=await db.execute({sql:"UPDATE payping_share_invites_v1 SET counted_at=? WHERE environment=? AND bot_id='mediax' AND invitee_id=? AND counted_at=''",args:[t,env(),uid]});
 if(!Number(counted.rowsAffected||0)||!rule)return {session,invite:null};
 const row=await one(db,"SELECT inviter_id,invitee_name FROM payping_share_invites_v1 WHERE environment=? AND bot_id='mediax' AND invitee_id=?",[env(),uid]);
 const inviter=String(row.inviter_id),state=await shareState(inviter,rule);
 let unlocked=false;
 if(state.canUnlock){await unlockShare(inviter,rule);unlocked=true}
 const invite={inviterId:inviter,friendName:String(row.invitee_name||''),invited:state.invited,needed:rule.needed,unlocked};
 if(notify&&!state.unlocked){
  const text=await shareNoticeText(unlocked?'unlocked':'joined',rule,{friendName:invite.friendName,invited:state.invited});
  await notify(inviter,text).catch(e=>console.warn('[payping-share] inviter notice failed:',String(e?.message||e).slice(0,120)));
 }
 return {session,invite};
}
