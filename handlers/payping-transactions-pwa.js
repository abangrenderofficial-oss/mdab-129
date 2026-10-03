const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#6d28d9"><title>PayPing! Transactions</title>
<link rel="manifest" href="/ar-payment/payping-v4.webmanifest"><link rel="icon" href="/ar-payment/payping-icon-v4.svg">
<style>
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 0,#27104f 0,#11111b 38%,#07070d 100%);color:#f8f8fb;padding:env(safe-area-inset-top) 15px calc(15px + env(safe-area-inset-right)) calc(90px + env(safe-area-inset-bottom)) calc(15px + env(safe-area-inset-left))}
main{max-width:680px;margin:auto;padding:22px 0}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}.brand{display:flex;align-items:center;gap:10px}.logo{width:42px;height:42px;border-radius:13px;overflow:hidden}.logo img{width:100%;height:100%}.title{font-size:21px;font-weight:900}.sub{font-size:12px;color:#939aaa}.back{color:#d8d0ff;text-decoration:none;background:#1b1e2a;padding:9px 11px;border-radius:12px;font-size:13px;font-weight:800}
.controls{display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:10px}.search,.select{background:#0c0f16;border:1px solid #292f3c;border-radius:13px;padding:12px;color:#fff;outline:none}.select{min-width:118px}
.list{display:flex;flex-direction:column;gap:9px}.item{display:block;text-decoration:none;color:inherit;background:rgba(18,21,30,.9);border:1px solid rgba(255,255,255,.07);border-radius:17px;padding:14px}.line{display:flex;justify-content:space-between;gap:12px}.amount{font-size:18px;font-weight:900}.who{font-weight:800;font-size:14px}.meta{font-size:11px;color:#858d9e;margin-top:6px;line-height:1.55}.badge{display:inline-block;padding:4px 7px;border-radius:999px;font-size:10px;font-weight:850;background:#292e38;color:#c9cfda}.badge.paid{background:rgba(57,217,138,.14);color:#79e4ae}.badge.creating,.badge.pending,.badge.checkout{background:rgba(255,190,60,.13);color:#ffd27c}
.empty,.loader{text-align:center;color:#8b92a1;padding:30px}.error{padding:16px;border-radius:15px;background:rgba(255,80,80,.08);color:#ffc0c0}
nav{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom));width:min(92%,560px);height:62px;background:rgba(17,19,28,.92);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.08);border-radius:19px;display:grid;grid-template-columns:repeat(4,1fr);padding:6px}nav a{text-decoration:none;color:#858c9c;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:11px;font-weight:800;border-radius:13px;gap:3px}nav a.active{color:#fff;background:rgba(126,77,255,.17)}nav b{font-size:18px}

/* PAYPING_MOBILE_REFERENCE_V1 */
@media(max-width:619px){
  :root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Segoe UI",sans-serif}
  body{padding:0;overflow:hidden;background-attachment:fixed;background-size:100vw 100vh;background-repeat:no-repeat}
  body::before{content:"";position:fixed;z-index:1000;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 18px);height:1px;background:rgba(255,255,255,.06);pointer-events:none}
  main{position:fixed;top:calc(env(safe-area-inset-top,0px) + 19px);left:calc(18px + env(safe-area-inset-left));right:calc(18px + env(safe-area-inset-right));bottom:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px 0 calc(96px + env(safe-area-inset-bottom))}
  .title{font-size:24px;line-height:1.08}
  .sub{font-size:13px;line-height:1.3}
  nav{z-index:1002;left:0;transform:none;bottom:0;width:100%;height:calc(76px + env(safe-area-inset-bottom));padding:8px 18px calc(8px + env(safe-area-inset-bottom));background:#07070d;border:0;border-radius:0;backdrop-filter:none;box-shadow:none}
  nav a{font-size:12px;gap:4px}
  nav b{font-size:24px;line-height:1}
}

@media(max-width:619px){
  .back{font-size:14px}.search,.select{font-size:14px}.amount{font-size:19px}.who{font-size:15px}.meta{font-size:12px}.badge{font-size:10px}
}
</style></head><body>
<main>
<div class="top"><div class="brand"><div class="logo"><img src="/ar-payment/payping-icon-v4.svg"></div><div><div class="title">Transactions</div><div id="scope" class="sub">PayPing!</div></div></div><a class="back" href="/ar-payment/">Home</a></div>
<div class="controls"><input id="search" class="search" placeholder="Search ID, order, transaction…"><select id="status" class="select"><option value="ALL">All</option><option value="PAID">Paid</option><option value="CREATING">Pending</option></select></div>
<div id="loading" class="loader">Loading transactions…</div><div id="list" class="list"></div>
</main>
<nav><a href="/ar-payment/"><b>⌂</b>Home</a><a class="active" href="/ar-payment/transactions"><b>≡</b>Transactions</a><a href="/ar-payment/affiliate"><b>₿</b>Earn</a><a href="/ar-payment/settings"><b>⚙</b>Settings</a></nav>
<script>
const token=localStorage.getItem('ar_payment_device_token_v1')||'';const $=id=>document.getElementById(id);let timer=null;
const headers=()=>({Authorization:'Bearer '+token});const money=v=>'RM'+(Number(v||0)||0).toFixed(2);
const date=v=>{if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?'-':new Intl.DateTimeFormat('en-MY',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}).format(d)};
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
async function load(){
 if(!token){$('loading').innerHTML='<div class="error">Connect PayPing notification/device dulu dari Home.</div>';return}
 const p=new URLSearchParams({view:'transactions',status:$('status').value,search:$('search').value.trim(),limit:'100'});
 try{const r=await fetch('/api/payping-data?'+p,{headers:headers()});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.message||'Unable to load transactions.');
 $('scope').textContent=d.owner?'Merchant view · All payments':'My payments';
 $('loading').hidden=true;
 $('list').innerHTML=d.transactions.length?d.transactions.map(t=>'<a class="item" href="/ar-payment/transaction?order='+encodeURIComponent(t.orderNumber)+'"><div class="line"><div><div class="who">'+esc(t.displayName||t.username||('ID '+t.userId))+'</div><div class="meta">'+esc(t.tierLabel)+' · '+esc(t.orderNumber)+'</div></div><div style="text-align:right"><div class="amount">'+money(t.amount)+'</div><span class="badge '+esc(t.status.toLowerCase())+'">'+esc(t.status)+'</span></div></div><div class="meta">Transaction: '+esc(t.transactionId||'-')+'<br>'+date(t.paidAt||t.createdAt)+' · Tap for details →</div></a>').join(''):'<div class="empty">No transactions found.</div>';
 }catch(e){$('loading').hidden=false;$('loading').innerHTML='<div class="error">'+esc(e.message||String(e))+'</div>'}
}
$('status').addEventListener('change',load);$('search').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(load,300)});load();
</script></body></html>`;

function send(res,type,body){res.statusCode=200;res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');res.end(body)}
export default function payPingTransactionsPage(req,res){
 if(req.method!=='GET'&&req.method!=='HEAD')return res.status(405).send('Method Not Allowed');
 return send(res,'text/html; charset=utf-8',req.method==='HEAD'?'':PAGE);
}
