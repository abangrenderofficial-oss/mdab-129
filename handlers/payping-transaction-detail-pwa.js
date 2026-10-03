const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#6d28d9"><title>PayPing! Transaction Detail</title>
<link rel="manifest" href="/ar-payment/payping-v4.webmanifest"><link rel="icon" href="/ar-payment/payping-icon-v4.svg">
<style>
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 0,#27104f 0,#11111b 38%,#07070d 100%);color:#f8f8fb;padding:env(safe-area-inset-top) 15px calc(15px + env(safe-area-inset-right)) calc(90px + env(safe-area-inset-bottom)) calc(15px + env(safe-area-inset-left))}
main{max-width:680px;margin:auto;padding:22px 0}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}.brand{display:flex;gap:10px;align-items:center}.logo{width:42px;height:42px;border-radius:13px;overflow:hidden}.logo img{width:100%;height:100%}.title{font-size:20px;font-weight:900}.sub{font-size:11px;color:#9299aa}.back{padding:9px 11px;border-radius:12px;background:#1d2130;color:#ddd4ff;text-decoration:none;font-size:13px;font-weight:800}
.hero{padding:19px;background:linear-gradient(145deg,rgba(128,71,255,.25),rgba(28,21,55,.8));border:1px solid rgba(158,120,255,.22);border-radius:22px;margin-bottom:12px}.heroTop{display:flex;justify-content:space-between;gap:12px}.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#bba8ff;font-weight:850}.amount{font-size:36px;font-weight:950;letter-spacing:-1px;margin:6px 0 3px}.badge{display:inline-block;padding:5px 8px;border-radius:999px;font-size:10px;font-weight:850;background:#292e38;color:#c9cfda}.badge.paid,.badge.sent,.badge.available{background:rgba(57,217,138,.13);color:#79e4ae}.badge.failed,.badge.rejected{background:rgba(255,80,80,.13);color:#ffa4a4}.badge.pending,.badge.creating,.badge.withdrawal_pending{background:rgba(255,190,60,.13);color:#ffd27c}
.card{background:rgba(18,21,30,.89);border:1px solid rgba(255,255,255,.07);border-radius:19px;padding:16px;margin-bottom:12px}.cardTitle{font-weight:900;font-size:15px;margin-bottom:10px}.row{display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.055);font-size:12px}.row:last-child{border-bottom:0}.row span:first-child{color:#9098a8}.row strong{text-align:right;max-width:62%;word-break:break-word}.copy{cursor:pointer;color:#cbbfff}.timeline{display:flex;flex-direction:column;gap:8px}.event{padding:11px;background:#0b0e15;border:1px solid rgba(255,255,255,.055);border-radius:13px}.eventTitle{font-size:12px;font-weight:850}.meta{font-size:10px;color:#858d9c;margin-top:5px;line-height:1.5}.msgbox{padding:12px;background:#0b0e15;border-radius:13px;color:#c7ccd7;font-size:12px;line-height:1.55;white-space:pre-wrap}.empty,.loader{text-align:center;color:#8991a0;padding:28px}.error{padding:15px;border-radius:14px;background:rgba(255,70,70,.08);color:#ffc0c0}
nav{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom));width:min(94%,620px);height:62px;background:rgba(17,19,28,.92);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.08);border-radius:19px;display:grid;grid-template-columns:repeat(4,1fr);padding:6px}nav a{text-decoration:none;color:#858c9c;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:10px;font-weight:800;border-radius:13px;gap:3px}nav a.active{color:#fff;background:rgba(126,77,255,.17)}nav b{font-size:17px}

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
  .back{font-size:14px}.eyebrow{font-size:12px}.cardTitle{font-size:16px}.row{font-size:13px}
  .eventTitle,.msgbox{font-size:13px}.meta{font-size:11px}.badge{font-size:10px}
}
</style></head>
<body><main>
<div class="top"><div class="brand"><div class="logo"><img src="/ar-payment/payping-icon-v4.svg"></div><div><div class="title">Transaction Detail</div><div id="orderTitle" class="sub">PayPing!</div></div></div><a class="back" href="/ar-payment/transactions">Back</a></div>
<div id="loading" class="loader">Loading transaction…</div>
<div id="app" hidden>
<section class="hero"><div class="heroTop"><div><div class="eyebrow">Payment amount</div><div id="amount" class="amount">RM0.00</div><div id="tier" class="sub">Supporter</div></div><div><span id="status" class="badge">-</span></div></div></section>

<section class="card"><div class="cardTitle">Payment</div>
<div class="row"><span>Order ID</span><strong id="orderId" class="copy"></strong></div>
<div class="row"><span>Transaction ID</span><strong id="transactionId" class="copy">-</strong></div>
<div class="row"><span>Gateway Status</span><strong id="gatewayStatus">-</strong></div>
<div class="row"><span>Status Description</span><strong id="statusDescription">-</strong></div>
<div id="paymentIntentRow" class="row" hidden><span>Payment Intent ID</span><strong id="paymentIntentId" class="copy">-</strong></div>
<div class="row"><span>Created</span><strong id="createdAt">-</strong></div>
<div class="row"><span>Paid</span><strong id="paidAt">-</strong></div>
</section>

<section class="card"><div class="cardTitle">Customer</div>
<div class="row"><span>Name</span><strong id="displayName">-</strong></div>
<div class="row"><span>Telegram</span><strong id="username">-</strong></div>
<div class="row"><span>User ID</span><strong id="userId">-</strong></div>
<div class="row"><span>Support State</span><strong id="submissionState">-</strong></div>
<div id="supportMessageWrap" hidden><div class="meta" style="margin:10px 0 6px">Support message</div><div id="supportMessage" class="msgbox"></div></div>
</section>

<section id="affiliateCard" class="card" hidden><div class="cardTitle">Affiliate Commission</div><div id="affiliateBody"></div></section>
<section class="card"><div class="cardTitle">Notification Delivery</div><div id="notificationSummary" class="row"></div><div id="notifications" class="timeline" style="margin-top:9px"></div></section>
<section class="card"><div class="cardTitle">Bayarcash Callback History</div><div id="callbacks" class="timeline"></div></section>
</div>
</main>
<nav><a href="/ar-payment/"><b>⌂</b>Home</a><a class="active" href="/ar-payment/transactions"><b>≡</b>Transactions</a><a href="/ar-payment/affiliate"><b>₿</b>Earn</a><a href="/ar-payment/settings"><b>⚙</b>Settings</a></nav>
<script>
const key='ar_payment_device_token_v1';const token=localStorage.getItem(key)||'';const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const date=v=>{if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?'-':new Intl.DateTimeFormat('en-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(d)};
const money=v=>'RM'+(Number(v||0)||0).toFixed(2);const headers=()=>({Authorization:'Bearer '+token});
function badge(s){const v=String(s||'').toLowerCase();return '<span class="badge '+esc(v)+'">'+esc(String(s||'-').replaceAll('_',' '))+'</span>'}
async function copyText(v){if(!v||v==='-')return;try{await navigator.clipboard.writeText(v)}catch{}}
async function load(){
 const order=new URLSearchParams(location.search).get('order')||'';
 if(!token){$('loading').innerHTML='<div class="error">Device belum connected.</div>';return}
 if(!order){$('loading').innerHTML='<div class="error">Order ID missing.</div>';return}
 try{
  const r=await fetch('/api/payping-data?'+new URLSearchParams({view:'transaction',order}),{headers:headers()});const d=await r.json();if(!r.ok||!d.ok)throw new Error(r.status===404?'Transaction not found or access denied.':(d.message||'Transaction detail unavailable.'));
  const t=d.transaction;$('orderTitle').textContent=t.orderNumber;$('amount').textContent=money(t.amount);$('tier').textContent=t.tierLabel||'Supporter';$('status').textContent=t.status||'-';$('status').className='badge '+String(t.status||'').toLowerCase();
  $('orderId').textContent=t.orderNumber;$('transactionId').textContent=t.transactionId||'-';$('gatewayStatus').textContent=t.gatewayStatus||'-';$('statusDescription').textContent=t.statusDescription||'-';$('createdAt').textContent=date(t.createdAt);$('paidAt').textContent=date(t.paidAt);
  $('displayName').textContent=t.displayName||'-';$('username').textContent=t.username?('@'+t.username):'-';$('userId').textContent=t.userId||'-';$('submissionState').textContent=t.submissionState||'-';
  if(t.paymentIntentId){$('paymentIntentRow').hidden=false;$('paymentIntentId').textContent=t.paymentIntentId}
  if(t.supportMessage){$('supportMessageWrap').hidden=false;$('supportMessage').textContent=t.supportMessage}
  if(d.affiliate?.generated){
    $('affiliateCard').hidden=false;
    $('affiliateBody').innerHTML=d.owner
      ? '<div class="row"><span>Commission</span><strong>'+money(d.affiliate.commissionAmount)+' ('+esc(d.affiliate.ratePercent)+'%)</strong></div><div class="row"><span>Status</span><strong>'+badge(d.affiliate.status)+'</strong></div><div class="row"><span>Referrer ID</span><strong>'+esc(d.affiliate.referrerUserId)+'</strong></div><div class="row"><span>Available At</span><strong>'+date(d.affiliate.availableAt)+'</strong></div>'
      : '<div class="row"><span>Affiliate</span><strong>Commission generated</strong></div>';
  }
  $('notificationSummary').innerHTML='<span>Push delivery</span><strong>'+d.notification.sent+' sent · '+d.notification.failed+' failed · '+d.notification.total+' total</strong>';
  $('notifications').innerHTML=d.notification.deliveries.length?d.notification.deliveries.map(x=>'<div class="event"><div class="eventTitle">'+badge(x.status)+'</div><div class="meta">'+date(x.updatedAt)+(x.lastError?'<br>'+esc(x.lastError):'')+'</div></div>').join(''):'<div class="empty">No push delivery recorded.</div>';
  $('callbacks').innerHTML=d.callbacks.length?d.callbacks.map(x=>'<div class="event"><div class="eventTitle">Gateway status '+esc(x.gatewayStatus)+' · '+money(x.amount)+'</div><div class="meta">Transaction: '+esc(x.transactionId||'-')+'<br>Received: '+date(x.receivedAt)+'</div></div>').join(''):'<div class="empty">No callback history recorded.</div>';
  document.querySelectorAll('.copy').forEach(el=>el.onclick=()=>copyText(el.textContent.trim()));
  $('loading').hidden=true;$('app').hidden=false;
 }catch(e){$('loading').innerHTML='<div class="error">'+esc(e.message||String(e))+'</div>'}
}
load();
</script></body></html>`;

function send(res,type,body){res.statusCode=200;res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');res.end(body)}
export default function payPingTransactionDetailPage(req,res){
 if(req.method!=='GET'&&req.method!=='HEAD')return res.status(405).send('Method Not Allowed');
 return send(res,'text/html; charset=utf-8',req.method==='HEAD'?'':PAGE);
}
