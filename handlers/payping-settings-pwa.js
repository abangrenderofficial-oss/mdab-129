const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#6d28d9"><title>PayPing! Settings</title>
<link rel="manifest" href="/ar-payment/payping-v4.webmanifest"><link rel="icon" href="/ar-payment/payping-icon-v4.svg">
<style>
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 0,#27104f 0,#11111b 38%,#07070d 100%);color:#f8f8fb;padding:env(safe-area-inset-top) 15px calc(15px + env(safe-area-inset-right)) calc(92px + env(safe-area-inset-bottom)) calc(15px + env(safe-area-inset-left))}
main{max-width:680px;margin:auto;padding:22px 0}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}.brand{display:flex;gap:10px;align-items:center}.logo{width:42px;height:42px;border-radius:13px;overflow:hidden}.logo img{width:100%;height:100%}.title{font-size:21px;font-weight:900}.sub{font-size:12px;color:#9299aa}
.card{background:rgba(18,21,30,.89);border:1px solid rgba(255,255,255,.07);border-radius:19px;padding:16px;margin-bottom:12px}.cardTitle{font-weight:900;font-size:15px;margin-bottom:11px}.profile{display:flex;align-items:center;gap:12px}.avatar{width:48px;height:48px;border-radius:16px;background:linear-gradient(135deg,#8b5cf6,#33d17a);display:grid;place-items:center;font-size:20px;font-weight:950}.name{font-size:16px;font-weight:900}.muted{font-size:11px;color:#8d95a5;line-height:1.5}.row{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.055);font-size:13px}.row:last-child{border-bottom:0}.row span:first-child{color:#929aaa}.link{display:block;padding:12px 0;text-decoration:none;color:#d9d1ff;font-weight:800;border-bottom:1px solid rgba(255,255,255,.055)}.link:last-child{border-bottom:0}
.device{padding:12px;background:#0b0e15;border:1px solid rgba(255,255,255,.055);border-radius:14px;margin-top:8px}.line{display:flex;justify-content:space-between;gap:10px;align-items:center}.deviceName{font-size:13px;font-weight:850}.badge{padding:4px 7px;border-radius:999px;background:#292e38;color:#c9cfda;font-size:9px;font-weight:850}.badge.current{background:rgba(57,217,138,.13);color:#79e4ae}.actions{margin-top:9px}.danger{border:0;border-radius:11px;padding:10px 12px;background:#342129;color:#ffabab;font-weight:850;font-size:12px}.danger.full{width:100%;margin-top:10px}.msg{font-size:12px;min-height:16px;margin-top:9px;color:#aeb5c3}.msg.bad{color:#ff9e9e}.loader{text-align:center;color:#8991a0;padding:28px}.error{padding:15px;border-radius:14px;background:rgba(255,70,70,.08);color:#ffc0c0}
nav{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom));width:min(94%,620px);height:62px;background:rgba(17,19,28,.92);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.08);border-radius:19px;display:grid;grid-template-columns:repeat(4,1fr);padding:6px}nav a{text-decoration:none;color:#858c9c;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:10px;font-weight:800;border-radius:13px;gap:3px}nav a.active{color:#fff;background:rgba(126,77,255,.17)}nav b{font-size:17px}
</style></head>
<body><main>
<div class="top"><div class="brand"><div class="logo"><img src="/ar-payment/payping-icon-v4.svg"></div><div><div class="title">Settings</div><div class="sub">Account & devices</div></div></div></div>
<div id="loading" class="loader">Loading account…</div>
<div id="app" hidden>
<section class="card"><div class="profile"><div id="avatar" class="avatar">P</div><div><div id="name" class="name">PayPing Owner</div><div id="username" class="muted"></div></div></div><div class="row"><span>Telegram ID</span><strong id="userId">-</strong></div><div class="row"><span>Role</span><strong id="role">Owner</strong></div><div class="row"><span>Environment</span><strong id="env">production</strong></div></section>
<section class="card"><div class="cardTitle">Merchant Tools</div><a id="analyticsLink" class="link" href="/ar-payment/analytics" hidden>Analytics / Reports →</a><a class="link" href="/ar-payment/notifications">Notification Status & History →</a></section>
<section class="card"><div class="cardTitle">Devices & Sessions</div><div id="devices"></div><button id="disconnectCurrent" class="danger full">Disconnect This Device</button><div id="msg" class="msg"></div></section>
<section class="card"><div class="cardTitle">Account Session</div><button id="logoutAccount" class="danger full">Logout PayPing Account</button></section><section class="card"><div class="cardTitle">About PayPing!</div><div class="row"><span>Payment provider</span><strong>Bayarcash</strong></div><div class="row"><span>Database</span><strong>Turso</strong></div><div class="row"><span>Heavy worker</span><strong>GitHub Actions</strong></div></section>
</div>
</main>
<nav><a href="/ar-payment/"><b>⌂</b>Home</a><a href="/ar-payment/transactions"><b>≡</b>Transactions</a><a href="/ar-payment/affiliate"><b>₿</b>Earn</a><a class="active" href="/ar-payment/settings"><b>⚙</b>Settings</a></nav>
<script>
const key='payping_auth_session_v1';const deviceKey='ar_payment_device_token_v1';const token=localStorage.getItem(deviceKey)||localStorage.getItem(key)||'';const $=id=>document.getElementById(id);
const headers=()=>({Authorization:'Bearer '+token,'Content-Type':'application/json'});const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const date=v=>{if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?'-':new Intl.DateTimeFormat('en-MY',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}).format(d)};
function setMsg(t,c=''){$('msg').textContent=t||'';$('msg').className='msg '+c}
async function load(){
 if(!token){$('loading').innerHTML='<div class="error">Device belum connected. Setup notification dari Home dulu.</div>';return}
 try{const r=await fetch('/api/payping-settings?view=account',{headers:headers()});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.message||'Account unavailable.');
  $('name').textContent=d.profile.displayName||'PayPing Owner';$('username').textContent=d.profile.username?'@'+d.profile.username:'';$('userId').textContent=d.profile.userId;$('role').textContent=d.owner?'Merchant Owner':'User';$('analyticsLink').hidden=!d.owner;$('env').textContent=d.environment;$('avatar').textContent=(d.profile.displayName||'P').trim().charAt(0).toUpperCase()||'P';
  $('devices').innerHTML=d.device.devices.map(x=>'<div class="device"><div class="line"><div><div class="deviceName">'+esc(x.current?'Current Device':'PayPing Device')+'</div><div class="muted">'+esc(x.endpointHost||'Push endpoint')+' · Updated '+date(x.updatedAt)+'</div></div><span class="badge '+(x.current?'current':'')+'">'+(x.active?(x.current?'CURRENT':'ACTIVE'):'DISCONNECTED')+'</span></div>'+(!x.current&&x.active?'<div class="actions"><button class="danger" data-revoke="'+esc(x.id)+'">Disconnect</button></div>':'')+'</div>').join('');
  document.querySelectorAll('[data-revoke]').forEach(btn=>btn.onclick=()=>revoke(btn.dataset.revoke));
  $('loading').hidden=true;$('app').hidden=false;
 }catch(e){$('loading').innerHTML='<div class="error">'+esc(e.message||String(e))+'</div>'}
}
async function revoke(id){if(!confirm('Disconnect this PayPing device?'))return;try{const r=await fetch('/api/payping-settings',{method:'POST',headers:headers(),body:JSON.stringify({action:'revoke_device',deviceId:id})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.message||'Disconnect failed.');setMsg('Device disconnected ✅');load()}catch(e){setMsg(e.message||String(e),'bad')}}
$('disconnectCurrent').addEventListener('click',async()=>{if(!confirm('Disconnect current PayPing device? Notification dan dashboard access pada device ini akan berhenti sehingga /pushsetup dibuat semula.'))return;try{const r=await fetch('/api/payping-settings',{method:'POST',headers:headers(),body:JSON.stringify({action:'disconnect_current'})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.message||'Disconnect failed.');localStorage.removeItem(deviceKey);location.href='/ar-payment/'}catch(e){setMsg(e.message||String(e),'bad')}});
$('logoutAccount').hidden=!localStorage.getItem(key);
$('logoutAccount').addEventListener('click',async()=>{const authToken=localStorage.getItem(key)||'';if(!authToken){location.href='/ar-payment/login';return}try{await fetch('/api/payping-auth',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+authToken},body:JSON.stringify({action:'logout'})})}catch{}localStorage.removeItem(key);location.href='/ar-payment/login'});
load();
</script></body></html>`;

function send(res,type,body){res.statusCode=200;res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');res.end(body)}
export default function payPingSettingsPage(req,res){
 if(req.method!=='GET'&&req.method!=='HEAD')return res.status(405).send('Method Not Allowed');
 return send(res,'text/html; charset=utf-8',req.method==='HEAD'?'':PAGE);
}
