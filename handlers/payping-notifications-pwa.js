const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#6d28d9"><title>PayPing! Notifications</title>
<link rel="manifest" href="/ar-payment/payping-v4.webmanifest"><link rel="icon" href="/ar-payment/payping-icon-v4.svg">
<style>
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 0,#27104f 0,#11111b 38%,#07070d 100%);color:#f8f8fb;padding:env(safe-area-inset-top) 15px calc(15px + env(safe-area-inset-right)) calc(92px + env(safe-area-inset-bottom)) calc(15px + env(safe-area-inset-left))}
main{max-width:680px;margin:auto;padding:22px 0}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}.brand{display:flex;gap:10px;align-items:center}.logo{width:42px;height:42px;border-radius:13px;overflow:hidden}.logo img{width:100%;height:100%}.title{font-size:21px;font-weight:900}.sub{font-size:12px;color:#9299aa}.back{padding:9px 11px;border-radius:12px;background:#1d2130;color:#ddd4ff;text-decoration:none;font-size:13px;font-weight:800}
.card{background:rgba(18,21,30,.89);border:1px solid rgba(255,255,255,.07);border-radius:19px;padding:16px;margin-bottom:12px}.cardTitle{font-weight:900;font-size:15px;margin-bottom:11px}.statusRow{display:flex;justify-content:space-between;align-items:center;gap:12px}.statusText{display:flex;align-items:center;gap:8px;font-weight:850}.dot{width:10px;height:10px;border-radius:50%;background:#39d98a;box-shadow:0 0 0 5px rgba(57,217,138,.1)}.muted{font-size:12px;color:#9098a8;line-height:1.5}
button{border:0;border-radius:13px;padding:12px 14px;color:#fff;font-weight:850;background:linear-gradient(135deg,#9b6bff,#6d28d9)}button:disabled{opacity:.45}.full{width:100%;margin-top:11px}.msg{font-size:12px;color:#aeb5c3;min-height:17px;margin-top:9px}.msg.ok{color:#79e4ad}.msg.bad{color:#ff9d9d}
.list{display:flex;flex-direction:column;gap:8px}.item{padding:12px;background:#0b0e15;border:1px solid rgba(255,255,255,.055);border-radius:14px}.line{display:flex;justify-content:space-between;gap:12px}.name{font-size:13px;font-weight:850}.meta{font-size:10px;color:#858d9c;margin-top:5px;line-height:1.5}.badge{display:inline-block;padding:4px 7px;border-radius:999px;font-size:9px;font-weight:850;background:#292e38;color:#c9cfda}.badge.sent{background:rgba(57,217,138,.13);color:#79e4ae}.badge.failed{background:rgba(255,80,80,.13);color:#ffa4a4}.empty,.loader{text-align:center;color:#8991a0;padding:26px}.error{padding:15px;border-radius:14px;background:rgba(255,70,70,.08);color:#ffc0c0}
nav{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom));width:min(94%,620px);height:62px;background:rgba(17,19,28,.92);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.08);border-radius:19px;display:grid;grid-template-columns:repeat(4,1fr);padding:6px}nav a{text-decoration:none;color:#858c9c;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:10px;font-weight:800;border-radius:13px;gap:3px}nav a.active{color:#fff;background:rgba(126,77,255,.17)}nav b{font-size:17px}

/* PAYPING_MOBILE_REFERENCE_V1 */
@media(max-width:619px){
  :root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Segoe UI",sans-serif}
  body{padding-top:calc(env(safe-area-inset-top,0px) + 18px)}
  body::before{content:"";position:fixed;z-index:1000;left:0;right:0;top:0;height:calc(env(safe-area-inset-top,0px) + 18px);background:linear-gradient(180deg,rgba(39,16,79,.995),rgba(29,14,56,.985));border-bottom:1px solid rgba(255,255,255,.20);pointer-events:none}
  main{padding-top:14px}
  .title{font-size:24px;line-height:1.08}
  .sub{font-size:13px;line-height:1.3}
  nav{height:68px}
  nav a{font-size:12px;gap:4px}
  nav b{font-size:24px;line-height:1}
}

@media(max-width:619px){
  .back{font-size:14px}.cardTitle{font-size:16px}.muted,.msg{font-size:13px}.name{font-size:14px}.meta{font-size:11px}.badge{font-size:10px}
}
</style></head>
<body><main>
<div class="top"><div class="brand"><div class="logo"><img src="/ar-payment/payping-icon-v4.svg"></div><div><div class="title">Notifications</div><div class="sub">Payment push status & history</div></div></div><a class="back" href="/ar-payment/">Home</a></div>
<div id="loading" class="loader">Loading notifications…</div>
<div id="app" hidden>
<section class="card"><div class="statusRow"><div><div class="statusText"><span class="dot"></span><span>Push Connected</span></div><div id="deviceText" class="muted" style="margin-top:6px">Current device</div></div><span id="permission" class="badge">Checking</span></div><button id="test" class="full">Send Test Notification</button><div id="msg" class="msg"></div></section>
<section class="card"><div class="cardTitle">Delivery History</div><div id="history" class="list"></div></section>
</div>
</main>
<nav><a href="/ar-payment/"><b>⌂</b>Home</a><a href="/ar-payment/transactions"><b>≡</b>Transactions</a><a href="/ar-payment/affiliate"><b>₿</b>Earn</a><a href="/ar-payment/settings"><b>⚙</b>Settings</a></nav>
<script>
const key='ar_payment_device_token_v1';const token=localStorage.getItem(key)||'';const $=id=>document.getElementById(id);
const headers=()=>({Authorization:'Bearer '+token,'Content-Type':'application/json'});const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const date=v=>{if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?'-':new Intl.DateTimeFormat('en-MY',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}).format(d)};
function setMsg(t,c=''){$('msg').textContent=t||'';$('msg').className='msg '+c}
function permission(){const p=('Notification'in window)?Notification.permission:'unsupported';$('permission').textContent=p==='granted'?'Allowed':p==='denied'?'Blocked':'Not granted';$('permission').className='badge '+(p==='granted'?'sent':p==='denied'?'failed':'')}
async function load(){
 permission();
 if(!token){$('loading').innerHTML='<div class="error">Device belum connected. Setup notification dari Home dulu.</div>';return}
 try{
  const r=await fetch('/api/payping-settings?view=notifications',{headers:headers()});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.message||'Notifications unavailable.');
  $('deviceText').textContent=d.device.activeDeviceCount+' active device'+(d.device.activeDeviceCount===1?'':'s')+' · current '+(d.device.devices.find(x=>x.current)?.endpointHost||'device');
  $('history').innerHTML=d.history.length?d.history.map(x=>{const keyText=x.deliveryKey.startsWith('order:')?'Payment '+x.deliveryKey.slice(6):x.deliveryKey;return '<div class="item"><div class="line"><div><div class="name">'+esc(keyText)+'</div><div class="meta">'+(x.currentDevice?'Current device':'Other device')+' · '+date(x.updatedAt)+'</div></div><span class="badge '+esc(x.status.toLowerCase())+'">'+esc(x.status)+'</span></div>'+(x.lastError?'<div class="meta" style="color:#ffabab">'+esc(x.lastError)+'</div>':'')+'</div>'}).join(''):'<div class="empty">No notification deliveries yet.</div>';
  $('loading').hidden=true;$('app').hidden=false;
 }catch(e){$('loading').innerHTML='<div class="error">'+esc(e.message||String(e))+'</div>'}
}
$('test').addEventListener('click',async()=>{try{$('test').disabled=true;setMsg('Sending test…');const r=await fetch('/api/payping-settings',{method:'POST',headers:headers(),body:JSON.stringify({action:'test_notification'})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.message||'Test notification failed.');setMsg('Test notification sent ✅','ok')}catch(e){setMsg(e.message||String(e),'bad')}finally{$('test').disabled=false}});
load();
</script></body></html>`;

function send(res,type,body){res.statusCode=200;res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');res.end(body)}
export default function payPingNotificationsPage(req,res){
 if(req.method!=='GET'&&req.method!=='HEAD')return res.status(405).send('Method Not Allowed');
 return send(res,'text/html; charset=utf-8',req.method==='HEAD'?'':PAGE);
}
