const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#6d28d9"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="PayPing!">
<title>PayPing!</title><link rel="manifest" href="/ar-payment/payping-v4.webmanifest"><link rel="icon" href="/ar-payment/payping-icon-v4.svg"><link rel="apple-touch-icon" href="/ar-payment/payping-icon-v4.svg">
<style>
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 0,#27104f 0,#11111b 38%,#07070d 100%);color:#f8f8fb;padding:env(safe-area-inset-top) 15px calc(15px + env(safe-area-inset-right)) calc(90px + env(safe-area-inset-bottom)) calc(15px + env(safe-area-inset-left))}
main{max-width:680px;margin:auto;padding:22px 0}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}.brand{display:flex;align-items:center;gap:11px}.logo{width:48px;height:48px;border-radius:15px;overflow:hidden}.logo img{width:100%;height:100%}.title{font-size:24px;font-weight:900}.sub{font-size:12px;color:#939aaa;margin-top:2px}.scope{padding:7px 9px;border-radius:999px;background:rgba(126,77,255,.13);color:#cdbfff;font-size:11px;font-weight:800}
.hero{padding:19px;background:linear-gradient(145deg,rgba(128,71,255,.25),rgba(28,21,55,.8));border:1px solid rgba(158,120,255,.22);border-radius:22px;margin-bottom:12px;box-shadow:0 22px 60px rgba(0,0,0,.25)}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#bba8ff;font-weight:850}.heroValue{font-size:37px;font-weight:950;letter-spacing:-1px;margin:5px 0 2px}.muted{font-size:12px;color:#9299aa}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:12px}.stat,.card{background:rgba(18,21,30,.89);border:1px solid rgba(255,255,255,.07);border-radius:18px;padding:14px}.stat .k{font-size:11px;color:#8d95a5}.stat .v{font-size:20px;font-weight:900;margin-top:6px}.card{margin-bottom:12px}.cardTitle{font-size:15px;font-weight:900;margin-bottom:11px}
.quick{display:grid;grid-template-columns:1fr 1fr;gap:9px}.quick a{padding:14px;border-radius:14px;text-decoration:none;color:#fff;background:#181c27;border:1px solid rgba(255,255,255,.05);font-size:13px;font-weight:850}.quick a.primary{background:linear-gradient(135deg,#9b6bff,#6d28d9)}
.list{display:flex;flex-direction:column;gap:8px}.tx{display:block;text-decoration:none;color:inherit;padding:11px;background:#0c0f16;border-radius:13px;border:1px solid rgba(255,255,255,.055)}.line{display:flex;justify-content:space-between;gap:10px}.name{font-size:13px;font-weight:800}.amount{font-size:14px;font-weight:900}.meta{font-size:10px;color:#858d9c;margin-top:5px}.badge{display:inline-block;padding:3px 6px;border-radius:999px;font-size:9px;font-weight:850;background:#2a2e39}.badge.paid{background:rgba(57,217,138,.13);color:#7ae5af}
.setupHead{display:flex;justify-content:space-between;align-items:center;gap:10px}.dot{width:9px;height:9px;border-radius:50%;background:#737786;display:inline-block;margin-right:7px}.dot.ok{background:#39d98a;box-shadow:0 0 0 4px rgba(57,217,138,.1)}.setupBody{margin-top:12px}.setupBody[hidden]{display:none}.setupSteps{font-size:12px;color:#aab0bd;line-height:1.55;padding-left:18px}
input.code{width:100%;background:#0c0f16;border:1px solid #292e3b;border-radius:13px;padding:13px;color:#fff;font-size:18px;letter-spacing:4px;text-align:center;margin-top:8px}.btn{width:100%;border:0;border-radius:13px;padding:13px;color:#fff;font-weight:850;margin-top:9px;background:linear-gradient(135deg,#9b6bff,#6d28d9)}.btn.secondary{background:#202532}.btn:disabled{opacity:.45}.msg{font-size:12px;color:#abb2c0;margin-top:9px;min-height:16px}
.loader,.empty{text-align:center;color:#8991a0;padding:24px}.error{padding:15px;border-radius:14px;background:rgba(255,70,70,.08);color:#ffc0c0}
nav{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom));width:min(92%,560px);height:62px;background:rgba(17,19,28,.92);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.08);border-radius:19px;display:grid;grid-template-columns:repeat(4,1fr);padding:6px}nav a{text-decoration:none;color:#858c9c;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:11px;font-weight:800;border-radius:13px;gap:3px}nav a.active{color:#fff;background:rgba(126,77,255,.17)}nav b{font-size:18px}
@media(min-width:620px){.grid{grid-template-columns:repeat(4,1fr)}}
</style></head>
<body><main>
<div class="top"><div class="brand"><div class="logo"><img src="/ar-payment/payping-icon-v4.svg"></div><div><div class="title">PayPing!</div><div class="sub">Payment dashboard</div></div></div><div id="scope" class="scope">Not connected</div></div>

<div id="dashLoading" class="loader">Loading PayPing…</div>
<div id="dashboard" hidden>
<section class="hero"><div class="eyebrow">Today received</div><div id="todayReceived" class="heroValue">RM0.00</div><div id="todayCount" class="muted">0 successful payments today</div></section>
<section class="grid">
<div class="stat"><div class="k">Total Received</div><div id="totalReceived" class="v">RM0.00</div></div>
<div class="stat"><div class="k">Paid</div><div id="paidCount" class="v">0</div></div>
<div class="stat"><div class="k">Pending</div><div id="pendingCount" class="v">0</div></div>
<div class="stat"><div class="k">All Transactions</div><div id="totalCount" class="v">0</div></div>
</section>
<section class="card"><div class="cardTitle">Quick Actions</div><div class="quick"><a class="primary" href="/ar-payment/transactions">Transactions</a><a href="/ar-payment/affiliate">Affiliate / Earn</a><a href="/ar-payment/notifications">Notifications</a><a href="/ar-payment/settings">Settings / Account</a></div></section>
<section class="card"><div class="line"><div class="cardTitle">Recent Payments</div><a href="/ar-payment/transactions" style="font-size:11px;color:#bfaeff;text-decoration:none">View all</a></div><div id="recent" class="list"></div></section>
</div>

<section class="card">
<div class="setupHead"><div><div class="cardTitle" style="margin:0"><span id="dot" class="dot"></span>Notifications</div><div id="state" class="muted">Belum connected</div></div><button id="toggleSetup" class="btn secondary" style="width:auto;margin:0;padding:9px 11px">Setup</button></div>
<div id="setupBody" class="setupBody" hidden>
<ol class="setupSteps"><li>Add PayPing! to Home Screen on iPhone.</li><li>Dalam private chat bot, taip <b>/pushsetup</b>.</li><li>Masukkan setup code 8 digit dan enable notification.</li></ol>
<input id="code" class="code" inputmode="numeric" maxlength="8" placeholder="00000000" autocomplete="one-time-code">
<button id="enable" class="btn">Enable Notifications</button><button id="test" class="btn secondary" disabled>Send Test Notification</button><div id="msg" class="msg"></div>
</div>
</section>
</main>
<nav><a class="active" href="/ar-payment/"><b>⌂</b>Home</a><a href="/ar-payment/transactions"><b>≡</b>Transactions</a><a href="/ar-payment/affiliate"><b>₿</b>Earn</a><a href="/ar-payment/settings"><b>⚙</b>Settings</a></nav>
<script>
const $=id=>document.getElementById(id);const deviceKey='ar_payment_device_token_v1';const token=()=>localStorage.getItem(deviceKey)||'';
const money=v=>'RM'+(Number(v||0)||0).toFixed(2);const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const date=v=>{if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?'-':new Intl.DateTimeFormat('en-MY',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(d)};
function refreshConnection(){const t=token();$('test').disabled=!t;$('dot').classList.toggle('ok',!!t);$('state').textContent=t?'Push connected ✅':'Belum connected'}
async function loadDashboard(){
 const t=token();if(!t){$('dashLoading').innerHTML='<div class="empty">Connect PayPing notifications untuk buka dashboard.</div>';$('scope').textContent='Not connected';return}
 try{const r=await fetch('/api/payping-data?view=dashboard',{headers:{Authorization:'Bearer '+t}});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.message||'Dashboard unavailable.');
 const s=d.summary;$('scope').textContent=d.owner?'Merchant view':'My view';$('todayReceived').textContent=money(s.todayReceived);$('todayCount').textContent=s.todayTransactions+' successful payments today';$('totalReceived').textContent=money(s.totalReceived);$('paidCount').textContent=s.paidTransactions;$('pendingCount').textContent=s.pendingTransactions;$('totalCount').textContent=s.totalTransactions;
 $('recent').innerHTML=d.recent.length?d.recent.map(t=>'<a class="tx" href="/ar-payment/transaction?order='+encodeURIComponent(t.orderNumber)+'"><div class="line"><div><div class="name">'+esc(t.displayName||t.username||('ID '+t.userId))+'</div><div class="meta">'+esc(t.tierLabel)+' · '+date(t.paidAt||t.createdAt)+' · Details →</div></div><div style="text-align:right"><div class="amount">'+money(t.amount)+'</div><span class="badge '+esc(t.status.toLowerCase())+'">'+esc(t.status)+'</span></div></div></a>').join(''):'<div class="empty">No payments yet.</div>';
 $('dashLoading').hidden=true;$('dashboard').hidden=false;
 }catch(e){$('dashLoading').innerHTML='<div class="error">'+esc(e.message||String(e))+'</div>'}
}
$('toggleSetup').addEventListener('click',()=>{$('setupBody').hidden=!$('setupBody').hidden});
const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
const b64ToBytes=s=>{const p='='.repeat((4-s.length%4)%4);const b=(s+p).replace(/-/g,'+').replace(/_/g,'/');const raw=atob(b);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))};
function setMsg(t,bad=false){$('msg').textContent=t;$('msg').style.color=bad?'#ff9a9a':'#abb2c0'}
if('serviceWorker' in navigator)navigator.serviceWorker.getRegistration('/ar-payment/').then(r=>r?.update()).catch(()=>{});
$('enable').addEventListener('click',async()=>{try{
 if(isIOS&&!isStandalone())throw new Error('iPhone: Add to Home Screen dulu, kemudian buka PayPing! dari Home Screen.');
 const code=$('code').value.trim();if(!/^\\d{8}$/.test(code))throw new Error('Masukkan setup code 8 digit daripada /pushsetup.');
 $('enable').disabled=true;setMsg('Preparing notifications…');
 const config=await fetch('/api/payment-push').then(r=>r.json());if(!config.ok||!config.configured||!config.publicKey)throw new Error('Web Push server belum ready.');
 const reg=await navigator.serviceWorker.register('/ar-payment/sw.js',{scope:'/ar-payment/'});const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Notification permission tidak dibenarkan.');
 let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToBytes(config.publicKey)});
 const response=await fetch('/api/payment-push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'subscribe',code,subscription:sub.toJSON()})});const d=await response.json();if(!response.ok||!d.ok)throw new Error(d.message||'Tak berjaya register device.');
 localStorage.setItem(deviceKey,d.deviceToken);$('code').value='';refreshConnection();setMsg('Connected ✅');$('dashLoading').hidden=false;$('dashboard').hidden=true;loadDashboard();
 }catch(e){setMsg(e.message||String(e),true)}finally{$('enable').disabled=false}});
$('test').addEventListener('click',async()=>{try{const t=token();if(!t)throw new Error('Device belum connected.');$('test').disabled=true;const r=await fetch('/api/payment-push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'test',deviceToken:t})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.message||'Test push gagal.');setMsg('Test push sent ✅')}catch(e){setMsg(e.message||String(e),true)}finally{refreshConnection()}});
refreshConnection();loadDashboard();
</script></body></html>`;

function send(res,type,body){res.statusCode=200;res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');res.end(body)}
export default function payPingHomePage(req,res){
 if(req.method!=='GET'&&req.method!=='HEAD')return res.status(405).send('Method Not Allowed');
 return send(res,'text/html; charset=utf-8',req.method==='HEAD'?'':PAGE);
}
