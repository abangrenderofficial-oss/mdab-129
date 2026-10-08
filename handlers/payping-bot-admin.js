import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { resolvePayPingIdentity } from '../src/payping/auth.js';
import { currentSupportEnvironment, getSupportDb } from '../src/support/store.js';
import { ensurePayPingCatalogSchema } from '../src/payping/catalog.js';

function clean(value,max=160){return String(value??'').replace(/\u0000/g,'').trim().slice(0,max)}
function slugify(value){
  return clean(value,80).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48);
}
function json(res,status,body){return res.status(status).json(body)}
function key(){
  const secret=clean(process.env.PAYPING_BOT_ENCRYPTION_KEY||process.env.SETUP_SECRET||process.env.TELEGRAM_WEBHOOK_SECRET,1000);
  if(!secret){const e=new Error('PayPing bot encryption belum configured.');e.code='PAYPING_BOT_ENCRYPTION_NOT_CONFIGURED';throw e}
  return createHash('sha256').update('payping-bot-secret-v1:'+secret).digest();
}
function encrypt(value){
  const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key(),iv);
  const encrypted=Buffer.concat([cipher.update(Buffer.from(String(value||''),'utf8')),cipher.final()]);
  return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}
function decrypt(payload){
  const p=String(payload||'').split('.');if(p.length!==4||p[0]!=='v1')return '';
  try{
    const d=createDecipheriv('aes-256-gcm',key(),Buffer.from(p[1],'base64url'));
    d.setAuthTag(Buffer.from(p[2],'base64url'));
    return Buffer.concat([d.update(Buffer.from(p[3],'base64url')),d.final()]).toString('utf8');
  }catch{return ''}
}
async function ensureSchema(){
  await ensurePayPingCatalogSchema();
  const db=await getSupportDb();
  await db.batch([
    `CREATE TABLE IF NOT EXISTS payping_bot_secrets (
      environment TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      telegram_token_ciphertext TEXT NOT NULL DEFAULT '',
      bayarcash_portal_key_ciphertext TEXT NOT NULL DEFAULT '',
      bayarcash_api_token_ciphertext TEXT NOT NULL DEFAULT '',
      bayarcash_api_secret_ciphertext TEXT NOT NULL DEFAULT '',
      telegram_avatar_data_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (environment, bot_id)
    )`,
    'CREATE INDEX IF NOT EXISTS idx_payping_bots_telegram_id ON payping_bots(environment, telegram_bot_id)'
  ],'write');
  return db;
}
async function telegramJson(token,method,data={}){
  const r=await fetch('https://api.telegram.org/bot'+encodeURIComponent(token)+'/'+method,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),
    signal:AbortSignal.timeout(15000),
  });
  const body=await r.json().catch(()=>null);
  if(!r.ok||!body?.ok){
    const e=new Error(body?.description||'Telegram bot verification failed.');
    e.code='TELEGRAM_BOT_VERIFY_FAILED';throw e;
  }
  return body.result;
}
async function avatarDataUrl(token,userId){
  try{
    const photos=await telegramJson(token,'getUserProfilePhotos',{user_id:userId,limit:1});
    const sizes=photos?.photos?.[0]||[];const photo=sizes[sizes.length-1];if(!photo?.file_id)return '';
    const file=await telegramJson(token,'getFile',{file_id:photo.file_id});if(!file?.file_path)return '';
    const r=await fetch('https://api.telegram.org/file/bot'+encodeURIComponent(token)+'/'+file.file_path,{signal:AbortSignal.timeout(15000)});
    if(!r.ok)return '';const type=r.headers.get('content-type')||'image/jpeg';const buf=Buffer.from(await r.arrayBuffer());
    if(buf.length>1500000)return '';
    return 'data:'+type+';base64,'+buf.toString('base64');
  }catch{return ''}
}
async function verifyToken(token){
  const t=clean(token,220);if(!/^\d{6,15}:[A-Za-z0-9_-]{20,}$/.test(t)){
    const e=new Error('Format Telegram Bot Token tidak sah.');e.code='INVALID_TELEGRAM_BOT_TOKEN';throw e;
  }
  const me=await telegramJson(t,'getMe');
  if(!me?.is_bot){const e=new Error('Token ini bukan Telegram bot.');e.code='NOT_A_TELEGRAM_BOT';throw e}
  return {
    token:t,id:String(me.id||''),username:clean(me.username,80).replace(/^@+/,''),
    name:clean([me.first_name,me.last_name].filter(Boolean).join(' '),120)||clean(me.username,120),
    canJoinGroups:Boolean(me.can_join_groups),supportsInlineQueries:Boolean(me.supports_inline_queries),
    avatarDataUrl:await avatarDataUrl(t,me.id),
  };
}
async function owner(req){
  const auth=await resolvePayPingIdentity(req,{allowLegacyDevice:true});
  return auth&&auth.owner?auth:null;
}
function durationDays(period,value){
  const n=Math.max(1,Math.min(3650,Number(value||1)));
  if(period==='month')return Math.max(1,Math.round(n*30));
  if(period==='year')return Math.max(1,Math.round(n*365));
  return n;
}
async function createBot(input){
  const verified=await verifyToken(input.telegramToken);
  const db=await ensureSchema();const env=currentSupportEnvironment();
  const requested=slugify(input.slug||input.name||verified.username||verified.name);
  const botId=requested||('bot-'+verified.id);
  if(['mediax','musix'].includes(botId)){
    const e=new Error('Bot ID ini reserved. Pilih nama lain.');e.code='PAYPING_BOT_ID_RESERVED';throw e;
  }
  const dup=await db.execute({sql:'SELECT bot_id FROM payping_bots WHERE environment=? AND (bot_id=? OR slug=? OR telegram_bot_id=?) LIMIT 1',args:[env,botId,botId,verified.id]});
  if(dup.rows?.length){const e=new Error('Bot ini sudah wujud dalam PayPing.');e.code='PAYPING_BOT_EXISTS';throw e}
  const now=new Date().toISOString();const name=clean(input.name,120)||verified.name||verified.username;
  const planName=clean(input.planName,120)||'Supporter';
  const amount=Math.max(0,Math.round(Number(input.amount||0)*100));
  if(amount<=0){const e=new Error('Harga plan mesti lebih daripada RM0.');e.code='INVALID_PLAN_AMOUNT';throw e}
  const days=durationDays(clean(input.period,12).toLowerCase(),input.duration||1);
  const affiliateEnabled=Boolean(input.affiliateEnabled);
  const commission=Math.max(0,Math.min(100,Number(input.commissionPercent||0)));
  const portalKey=clean(input.portalKey,220),apiToken=clean(input.apiToken,500),apiSecret=clean(input.apiSecret,500);
  if(!portalKey||!apiToken||!apiSecret){const e=new Error('Maklumat Bayarcash belum lengkap.');e.code='BAYARCASH_CREDENTIALS_REQUIRED';throw e}
  const planId=botId+'-plan';const portalId=botId+'-bayarcash';
  await db.batch([
    {sql:`INSERT INTO payping_bots (environment,bot_id,slug,name,telegram_bot_id,telegram_username,status,affiliate_enabled,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,args:[env,botId,botId,name,verified.id,verified.username,'active',affiliateEnabled?1:0,now,now]},
    {sql:`INSERT INTO payping_plans (environment,plan_id,bot_id,name,amount_cents,duration_days,status,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`,args:[env,planId,botId,planName,amount,days,'active',now,now]},
    {sql:`INSERT INTO payping_payment_portals (environment,portal_id,bot_id,provider,label,portal_key_env,api_token_env,api_secret_env,status,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,args:[env,portalId,botId,'bayarcash',name+' Bayarcash','','','','active',now,now]},
    {sql:`INSERT INTO payping_bot_secrets (environment,bot_id,telegram_token_ciphertext,bayarcash_portal_key_ciphertext,bayarcash_api_token_ciphertext,bayarcash_api_secret_ciphertext,telegram_avatar_data_url,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`,args:[env,botId,encrypt(verified.token),encrypt(portalKey),encrypt(apiToken),encrypt(apiSecret),verified.avatarDataUrl||'',now,now]}
  ],'write');
  if(affiliateEnabled&&commission>0){
    // Default commission is stored as bot metadata. Individual affiliators can still override later.
    await db.execute({sql:`INSERT INTO payping_bot_affiliates (environment,bot_id,affiliate_user_id,status,commission_type,commission_value,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(environment,bot_id,affiliate_user_id) DO NOTHING`,args:[env,botId,'__default__','inactive','percent',commission,now,now]});
  }
  return {id:botId,name,telegramBotId:verified.id,telegramUsername:verified.username,status:'active',affiliateEnabled,plan:{id:planId,name:planName,amount:(amount/100).toFixed(2),durationDays:days},portal:{id:portalId,provider:'bayarcash',configured:true}};
}
async function setBotState(botId,status){
  const db=await ensureSchema();const env=currentSupportEnvironment();const id=slugify(botId);if(!id)return false;
  const now=new Date().toISOString();const r=await db.execute({sql:'UPDATE payping_bots SET status=?,updated_at=? WHERE environment=? AND bot_id=?',args:[status,now,env,id]});
  return Number(r.rowsAffected||0)>0;
}
async function disconnectBot(botId){
  const db=await ensureSchema();const env=currentSupportEnvironment();const id=slugify(botId);
  if(['mediax','musix'].includes(id)){const e=new Error('Default bot tak boleh dibuang dari sini.');e.code='DEFAULT_BOT_PROTECTED';throw e}
  const now=new Date().toISOString();
  await db.batch([
    {sql:'UPDATE payping_bots SET status=?,updated_at=? WHERE environment=? AND bot_id=?',args:['disconnected',now,env,id]},
    {sql:'UPDATE payping_payment_portals SET status=?,updated_at=? WHERE environment=? AND bot_id=?',args:['disconnected',now,env,id]},
    {sql:`UPDATE payping_bot_secrets SET telegram_token_ciphertext='',bayarcash_portal_key_ciphertext='',bayarcash_api_token_ciphertext='',bayarcash_api_secret_ciphertext='',updated_at=? WHERE environment=? AND bot_id=?`,args:[now,env,id]}
  ],'write');
  return true;
}
export async function getPayPingBotRuntimeCredentials(botId){
  const db=await ensureSchema();const env=currentSupportEnvironment();const id=slugify(botId);
  const r=await db.execute({sql:`SELECT telegram_token_ciphertext,bayarcash_portal_key_ciphertext,bayarcash_api_token_ciphertext,bayarcash_api_secret_ciphertext FROM payping_bot_secrets WHERE environment=? AND bot_id=? LIMIT 1`,args:[env,id]});
  const row=r.rows?.[0];if(!row)return null;
  return {telegramToken:decrypt(row.telegram_token_ciphertext),portalKey:decrypt(row.bayarcash_portal_key_ciphertext),apiToken:decrypt(row.bayarcash_api_token_ciphertext),apiSecret:decrypt(row.bayarcash_api_secret_ciphertext)};
}

export default async function handler(req,res){
  if(!['POST'].includes(req.method)){res.setHeader('Allow','POST');return json(res,405,{ok:false,error:'method_not_allowed'})}
  const auth=await owner(req);if(!auth)return json(res,403,{ok:false,error:'PAYPING_OWNER_ONLY'});
  try{
    const body=req.body&&typeof req.body==='object'?req.body:{};
    const action=clean(body.action,40).toLowerCase();
    if(action==='verify_telegram'){
      const v=await verifyToken(body.telegramToken);
      return json(res,200,{ok:true,bot:{telegramBotId:v.id,telegramUsername:v.username,name:v.name,avatarDataUrl:v.avatarDataUrl,canJoinGroups:v.canJoinGroups,supportsInlineQueries:v.supportsInlineQueries}});
    }
    if(action==='create_bot')return json(res,201,{ok:true,bot:await createBot(body)});
    if(action==='pause_bot')return json(res,200,{ok:true,updated:await setBotState(body.botId,'paused')});
    if(action==='activate_bot')return json(res,200,{ok:true,updated:await setBotState(body.botId,'active')});
    if(action==='disconnect_bot'){await disconnectBot(body.botId);return json(res,200,{ok:true})}
    return json(res,400,{ok:false,error:'UNKNOWN_BOT_ADMIN_ACTION'});
  }catch(error){
    console.error('[payping-bot-admin]',error?.code,error?.message);
    const bad=['INVALID_TELEGRAM_BOT_TOKEN','TELEGRAM_BOT_VERIFY_FAILED','NOT_A_TELEGRAM_BOT','INVALID_PLAN_AMOUNT','BAYARCASH_CREDENTIALS_REQUIRED','PAYPING_BOT_ID_RESERVED','PAYPING_BOT_EXISTS','DEFAULT_BOT_PROTECTED'].includes(String(error?.code||''));
    return json(res,bad?400:500,{ok:false,error:String(error?.code||'PAYPING_BOT_ADMIN_FAILED'),message:error?.message||'Bot setup failed.'});
  }
}
