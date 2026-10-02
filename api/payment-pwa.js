const PAGE = String.raw`<!doctype html>
<html lang="ms">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#6d28d9">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="PayPing!">
  <title>PayPing!</title>
  <link rel="manifest" href="/ar-payment/payping.webmanifest">
  <link rel="icon" href="/ar-payment/payping-icon.svg">
  <link rel="apple-touch-icon" href="/ar-payment/payping-icon.svg">
  <style>
    :root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at top,#24104a 0,#11111b 40%,#07070d 100%);color:#f7f7fb;padding:env(safe-area-inset-top) 18px env(safe-area-inset-bottom)}
    main{max-width:560px;margin:0 auto;padding:34px 0 48px}.brand{display:flex;align-items:center;gap:12px;margin-bottom:22px}
    .logo{width:54px;height:54px;border-radius:16px;background:linear-gradient(135deg,#9b6bff 0%,#7c3aed 48%,#5b21d8 100%);display:grid;place-items:center;overflow:hidden}.logo svg{width:46px;height:46px;display:block}
    h1{font-size:28px;margin:0}.muted{color:#9da3b3;font-size:14px;margin-top:4px}.card{background:rgba(19,22,31,.86);border:1px solid rgba(255,255,255,.08);border-radius:22px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.34);backdrop-filter:blur(16px);margin-bottom:14px}
    .status{display:flex;align-items:center;gap:9px;font-weight:700;margin-bottom:14px}.dot{width:10px;height:10px;border-radius:50%;background:#737786}.dot.ok{background:#39d98a;box-shadow:0 0 0 5px rgba(57,217,138,.1)}
    ol{padding-left:20px;color:#c8ccd6;line-height:1.55;margin:0}li+li{margin-top:7px}label{display:block;font-size:13px;color:#aeb4c2;margin:16px 0 7px}
    input{width:100%;background:#0c0f16;border:1px solid #292e3b;border-radius:14px;padding:15px;color:white;font-size:20px;letter-spacing:4px;text-align:center;outline:none}
    input:focus{border-color:#8b5cf6;box-shadow:0 0 0 3px rgba(139,92,246,.14)}button{width:100%;border:0;border-radius:14px;padding:15px 16px;font-size:16px;font-weight:800;margin-top:11px;color:white;background:linear-gradient(135deg,#9b6bff,#6d28d9)}
    button.secondary{background:#202532}button:disabled{opacity:.45}#msg{font-size:14px;line-height:1.45;margin-top:12px;color:#b7bdca;min-height:20px}
    .sample{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#090b11;border-radius:14px;padding:14px;white-space:pre-wrap;font-size:12px;line-height:1.5;color:#d6dae3}.small{font-size:12px;color:#777e8d;margin-top:10px}
  </style>
</head>
<body>
<main>
  <div class="brand"><div class="logo" aria-label="PayPing! logo"><svg viewBox="0 0 64 64" aria-hidden="true"><path fill="#fff" fill-rule="evenodd" d="M13 12h21c10.5 0 19 8.1 19 18s-8.5 18-19 18h-7v4c0 6.6-5.4 12-12 12h-2V12zm14 11v14h7c4.5 0 8-3 8-7s-3.5-7-8-7h-7z"/><path d="M48 20c4 3.5 6 7.5 6 12s-2 8.5-6 12M54 14c6.2 5.2 9 11.2 9 18s-2.8 12.8-9 18" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/></svg></div><div><h1>PayPing!</h1><div class="muted">Private payment push notification</div></div></div>
  <section class="card">
    <div class="status"><span id="dot" class="dot"></span><span id="state">Belum connected</span></div>
    <ol>
      <li>Di Safari tekan <b>Share → Add to Home Screen</b>.</li>
      <li>Buka <b>PayPing!</b> dari Home Screen.</li>
      <li>Dalam private chat bot, taip <b>/pushsetup</b>.</li>
      <li>Masukkan setup code 8 digit di bawah dan enable notification.</li>
    </ol>
    <label for="code">Setup code</label>
    <input id="code" inputmode="numeric" maxlength="8" placeholder="00000000" autocomplete="one-time-code">
    <button id="enable">Enable Notifications</button>
    <button id="test" class="secondary" disabled>Send Test Notification</button>
    <div id="msg"></div>
    <div class="small">Setup code hanya sah 10 minit dan hanya boleh digunakan sekali.</div>
  </section>
  <section class="card"><div class="muted" style="margin-bottom:10px">Contoh notification</div><div class="sample">PayPing!
ID 123456789 - RM10.00 - Successful ✅</div></section>
</main>
<script>
const $=id=>document.getElementById(id);
const deviceKey='ar_payment_device_token_v1';
const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
const b64ToBytes=(s)=>{const p='='.repeat((4-s.length%4)%4);const b=(s+p).replace(/-/g,'+').replace(/_/g,'/');const raw=atob(b);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))};
function setMsg(text,bad=false){$('msg').textContent=text;$('msg').style.color=bad?'#ff8f8f':'#b7bdca'}
function refresh(){const token=localStorage.getItem(deviceKey);$('test').disabled=!token;$('dot').classList.toggle('ok',!!token);$('state').textContent=token?'Push connected ✅':'Belum connected'}
refresh();
if('serviceWorker' in navigator){
  navigator.serviceWorker.getRegistration('/ar-payment/').then(reg=>reg?.update()).catch(()=>{});
}
$('enable').addEventListener('click',async()=>{
  try{
    if(isIOS&&!isStandalone()) throw new Error('iPhone: Add to Home Screen dulu, kemudian buka PayPing! dari Home Screen.');
    if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)) throw new Error('Browser/device ini belum support Web Push.');
    const code=$('code').value.trim();if(!/^\d{8}$/.test(code)) throw new Error('Masukkan setup code 8 digit daripada /pushsetup.');
    const timeout=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(label)),ms))]);
    setMsg('Step 1/4 — checking server…');$('enable').disabled=true;
    const config=await timeout(fetch('/api/payment-push').then(r=>r.json()),10000,'Server timeout. Cuba lagi.');
    if(!config.ok||!config.configured||!config.publicKey) throw new Error('Web Push server belum ready.');

    setMsg('Step 2/4 — preparing notification…');
    const reg=await timeout(navigator.serviceWorker.register('/ar-payment/sw.js',{scope:'/ar-payment/'}),10000,'Service worker timeout. Tutup app, buka semula dan cuba lagi.');
    await timeout(reg.update().catch(()=>null),8000,'Service worker update timeout.');

    setMsg('Step 3/4 — waiting notification permission…');
    const permission=await timeout(Notification.requestPermission(),15000,'Permission popup tak muncul. Semak Settings → Notifications → PayPing!.');
    if(permission!=='granted') throw new Error('Notification permission tidak dibenarkan.');

    setMsg('Step 4/4 — registering iPhone…');
    let sub=await timeout(reg.pushManager.getSubscription(),10000,'Push subscription timeout.');
    if(!sub){
      sub=await timeout(reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToBytes(config.publicKey)}),20000,'iPhone push registration timeout. Cuba tutup app dan buka semula.');
    }
    const response=await timeout(fetch('/api/payment-push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'subscribe',code,subscription:sub.toJSON()})}),15000,'Server register timeout. Cuba lagi.');
    const data=await response.json();if(!response.ok||!data.ok) throw new Error(data.message||'Tak berjaya register device.');
    localStorage.setItem(deviceKey,data.deviceToken);$('code').value='';refresh();setMsg('Connected ✅. Tekan Send Test Notification untuk test Lock Screen.');
  }catch(e){setMsg(e.message||String(e),true)}finally{$('enable').disabled=false}
});
$('test').addEventListener('click',async()=>{
  try{
    const token=localStorage.getItem(deviceKey);if(!token) throw new Error('Device belum connected.');
    setMsg('Sending test…');$('test').disabled=true;
    const response=await fetch('/api/payment-push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'test',deviceToken:token})});
    const data=await response.json();if(!response.ok||!data.ok) throw new Error(data.message||'Test push gagal.');
    setMsg('Test push dah dihantar ✅. Keluar dari app / lock iPhone dan tengok notification.');
  }catch(e){setMsg(e.message||String(e),true)}finally{refresh()}
});
</script>
</body>
</html>`;

const MANIFEST = JSON.stringify({
  name:'PayPing!',short_name:'PayPing!',start_url:'/ar-payment/?brand=payping',scope:'/ar-payment/',display:'standalone',
  background_color:'#090611',theme_color:'#6d28d9',
  icons:[{src:'/ar-payment/payping-icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}],
});

const SERVICE_WORKER = String.raw`
self.skipWaiting();
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data = {}; try { data = event.data ? event.data.json() : {}; } catch {}
  const title = data.title || 'PayPing!';
  const options = {
    icon: '/ar-payment/payping-icon.svg',
    badge: '/ar-payment/payping-icon.svg',
    tag: data.tag || 'ar-payment',
    data: { url: data.url || '/ar-payment/' }
  };
  if (typeof data.body === 'string' && data.body.length) options.body = data.body;
  event.waitUntil(self.registration.showNotification(title, options));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification?.data?.url || '/ar-payment/';
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list => {
    for (const client of list) { if ('focus' in client) { client.navigate(target); return client.focus(); } }
    return clients.openWindow(target);
  }));
});
`;

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#a675ff"/><stop offset=".5" stop-color="#7c3aed"/><stop offset="1" stop-color="#5b21d8"/></linearGradient></defs><rect width="512" height="512" rx="116" fill="url(#bg)"/><path fill="#fff" fill-rule="evenodd" d="M112 102h171c85 0 154 65 154 145s-69 145-154 145h-56v30c0 49-40 88-88 88h-27V102zm115 89v112h56c36 0 65-25 65-56s-29-56-65-56h-56z"/><path d="M387 172c30 23 45 48 45 75s-15 52-45 75M430 131c48 36 70 74 70 116s-22 80-70 116" fill="none" stroke="#fff" stroke-width="32" stroke-linecap="round"/></svg>`;

function send(res,type,body,extra={}){res.statusCode=200;res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');for(const [k,v] of Object.entries(extra))res.setHeader(k,v);res.end(body)}
export function paymentPwaPageHandler(req,res){
  if(req.method!=='GET'&&req.method!=='HEAD')return res.status(405).send('Method Not Allowed');
  const path=String(req.url||'').split('?')[0];
  if(path==='/ar-payment'){
    res.statusCode=302;
    res.setHeader('Location','/ar-payment/');
    res.setHeader('Cache-Control','no-store');
    return res.end();
  }
  return send(res,'text/html; charset=utf-8',req.method==='HEAD'?'':PAGE);
}
export function paymentPwaManifestHandler(req,res){if(req.method!=='GET'&&req.method!=='HEAD')return res.status(405).send('Method Not Allowed');return send(res,'application/manifest+json; charset=utf-8',req.method==='HEAD'?'':MANIFEST)}
export function paymentPwaServiceWorkerHandler(req,res){if(req.method!=='GET'&&req.method!=='HEAD')return res.status(405).send('Method Not Allowed');return send(res,'application/javascript; charset=utf-8',req.method==='HEAD'?'':SERVICE_WORKER,{'Service-Worker-Allowed':'/ar-payment/'})}
export function paymentPwaIconHandler(req,res){if(req.method!=='GET'&&req.method!=='HEAD')return res.status(405).send('Method Not Allowed');return send(res,'image/svg+xml; charset=utf-8',req.method==='HEAD'?'':ICON)}
