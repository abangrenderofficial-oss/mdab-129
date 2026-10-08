const PAGE = String.raw`<!doctype html>
<html lang="ms">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#6d28d9">
  <title>Affiliate Detail · PayPing!</title>
  <link rel="manifest" href="/ar-payment/payping-v4.webmanifest">
  <link rel="icon" href="/ar-payment/payping-icon-v4.svg">
  <style>
    :root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 0,#28124f 0,#11111b 38%,#07070d 100%);color:#f8f8fb;padding:env(safe-area-inset-top) 16px calc(16px + env(safe-area-inset-right)) calc(30px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left))}
    main{max-width:680px;margin:0 auto;padding:22px 0 36px}.top{display:flex;align-items:center;gap:11px;margin-bottom:17px}.back{width:44px;height:44px;display:grid;place-items:center;border-radius:14px;background:#1d2130;color:#eee7ff;text-decoration:none;font-size:25px}.title{font-size:20px;font-weight:900}.sub{font-size:12px;color:#949bad;margin-top:2px}
    .hero{background:linear-gradient(145deg,rgba(132,75,255,.24),rgba(31,22,62,.76));border:1px solid rgba(164,126,255,.2);border-radius:23px;padding:18px;margin-bottom:12px}.hero-label{font-size:13px;color:#b7a8df}.hero-value{font-size:34px;font-weight:950;letter-spacing:-1px;margin:5px 0 2px}.hero-meta{font-size:12px;color:#989fb0}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:17px}.stat{padding:11px 9px;background:rgba(19,22,31,.86);border:1px solid rgba(255,255,255,.07);border-radius:15px;text-align:center}.stat .v{font-size:17px;font-weight:900}.stat .k{font-size:10px;color:#838b9b;margin-top:3px}
    .card{background:rgba(19,22,31,.86);border:1px solid rgba(255,255,255,.07);border-radius:20px;margin-bottom:12px;overflow:hidden}.card-pad{padding:16px}.card-title{font-size:15px;font-weight:900}.card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
    .audit{border-color:rgba(123,222,169,.22)}.audit.bad{border-color:rgba(255,126,126,.24)}.audit-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.audit-amount{font-size:28px;font-weight:950;letter-spacing:-.7px}.pill{display:inline-flex;align-items:center;padding:6px 9px;border-radius:999px;font-size:11px;font-weight:900;background:rgba(57,217,138,.14);color:#78e3ad}.pill.bad{background:rgba(255,90,90,.13);color:#ffa0a0}.pill.pending{background:rgba(252,190,58,.13);color:#ffd273}
    .audit-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.mini{padding:10px 11px;background:#0b0e15;border-radius:13px}.mini .k{font-size:10px;color:#7f8797}.mini .v{font-size:14px;font-weight:850;margin-top:3px}.actions{display:grid;grid-template-columns:1.2fr .8fr;gap:8px;margin-top:13px}button{border:0;border-radius:13px;min-height:46px;padding:12px 13px;color:#fff;font-size:14px;font-weight:900;background:linear-gradient(135deg,#8b5cf6,#6d28d9)}button.reject{background:#34212a;color:#ffaaaa}button:disabled{opacity:.36}
    .wallet{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.wallet .mini{text-align:center;padding:9px 6px}.wallet .mini .v{font-size:13px}
    .rows{border-top:1px solid rgba(255,255,255,.055)}.row{min-height:62px;display:flex;align-items:center;gap:10px;padding:11px 15px;border-bottom:1px solid rgba(255,255,255,.05);text-decoration:none;color:inherit}.row:last-child{border-bottom:0}.row-main{min-width:0;flex:1}.name{font-size:13px;font-weight:820;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meta{font-size:10px;color:#7f8797;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.row-side{text-align:right}.amount{font-size:14px;font-weight:900}.commission{font-size:10px;color:#77dda8;margin-top:3px}.status{font-size:10px;color:#91899f;margin-top:3px}
    .disclose{width:100%;display:flex;justify-content:space-between;align-items:center;background:transparent;padding:14px 16px;color:#ddd7e8;text-align:left}.disclose span:last-child{color:#756c82;font-size:19px}.hidden{display:none!important}.empty{padding:18px;text-align:center;color:#7f8797;font-size:12px}.loader{text-align:center;padding:38px;color:#aab0bd}.error{padding:17px;border-radius:17px;background:rgba(255,70,70,.08);border:1px solid rgba(255,100,100,.18);color:#ffc1c1}.msg{font-size:12px;color:#aeb5c3;margin-top:10px}.msg.bad{color:#ff9f9f}.msg.ok{color:#79e4ad}
    /* PAYPING_MOBILE_REFERENCE_V1 */
    @media(max-width:619px){
      :root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Segoe UI",sans-serif}
      body{padding:0;overflow:hidden;background-attachment:fixed;background-size:100vw 100vh;background-repeat:no-repeat}
      body::before{content:"";position:fixed;z-index:1000;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 18px);height:1px;background:rgba(255,255,255,.06);pointer-events:none}
      main{position:fixed;top:calc(env(safe-area-inset-top,0px) + 19px);left:calc(18px + env(safe-area-inset-left));right:calc(18px + env(safe-area-inset-right));bottom:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px 0 calc(28px + env(safe-area-inset-bottom))}
      .title{font-size:24px;line-height:1.08}.sub{font-size:13px;line-height:1.3}.hero-value{font-size:32px}.wallet{grid-template-columns:1fr 1fr}
    }
    /* PAYPING_UX_POLISH_V2 */
    html{-webkit-text-size-adjust:100%;text-size-adjust:100%}body{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
    a,button,input,select{-webkit-tap-highlight-color:transparent}a,button,.row,.back,.disclose{touch-action:manipulation}
    @media(max-width:619px){
      main{scrollbar-width:none;overscroll-behavior-y:contain;scroll-padding-bottom:calc(104px + env(safe-area-inset-bottom))}main::-webkit-scrollbar{display:none}
      button,.back,.row,.disclose{min-height:44px}.row,.back,button,.disclose{transition:transform .14s ease,opacity .14s ease,border-color .16s ease,background-color .16s ease}.row:active,.back:active,button:active,.disclose:active{transform:scale(.985)}
      input,select,textarea{font-size:16px}.amount,.hero-value,.v{font-variant-numeric:tabular-nums}
    }
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}
  </style>
</head>
<body>
<main>
  <div class="top"><a class="back" href="/ar-payment/affiliate/admin">‹</a><div><div id="title" class="title">Affiliate</div><div id="sub" class="sub">Loading…</div></div></div>
  <div id="loading" class="loader">Loading…</div>
  <div id="blocked" class="error" hidden>Owner access sahaja.</div>
  <div id="app" hidden>
    <section id="auditCard" class="card audit hidden"><div class="card-pad">
      <div class="audit-top"><div><div class="hero-label">Payout request</div><div id="auditAmount" class="audit-amount">RM0.00</div></div><div id="auditPill" class="pill">Verified ✓</div></div>
      <div class="audit-grid"><div class="mini"><div class="k">Recalculated</div><div id="auditCalc" class="v">RM0.00</div></div><div class="mini"><div class="k">Payments checked</div><div id="auditPayments" class="v">0</div></div></div>
      <div id="auditMismatch" class="msg bad hidden"></div>
      <div id="auditActions" class="actions"><button id="markPaid">Mark Paid</button><button id="reject" class="reject">Reject</button></div>
      <div id="auditMsg" class="msg"></div>
    </div></section>

    <section class="hero"><div id="heroLabel" class="hero-label">Total earned</div><div id="earned" class="hero-value">RM0.00</div><div id="sales" class="hero-meta">RM0.00 sales generated</div></section>
    <section class="stats"><div class="stat"><div id="refs" class="v">0</div><div class="k">Referrals</div></div><div class="stat"><div id="paying" class="v">0</div><div class="k">Paying</div></div><div class="stat"><div id="payments" class="v">0</div><div class="k">Payments</div></div></section>

    <section class="card"><div class="card-pad"><div class="card-head"><div class="card-title">Wallet</div><div id="payoutHint" class="meta">No payout method</div></div><div class="wallet">
      <div class="mini"><div class="k">Pending</div><div id="pending" class="v">RM0</div></div>
      <div class="mini"><div class="k">Available</div><div id="available" class="v">RM0</div></div>
      <div class="mini"><div class="k">Withdrawing</div><div id="withdrawing" class="v">RM0</div></div>
      <div class="mini"><div class="k">Paid</div><div id="paid" class="v">RM0</div></div>
    </div></div></section>
    <section class="card"><div class="card-pad"><div class="card-title" style="margin-bottom:10px">Payout Method</div><div id="payoutDetail" class="meta">No payout method configured.</div></div></section>

    <section class="card"><div class="card-head card-pad" style="margin-bottom:0"><div class="card-title">Payments</div><div id="paymentCount" class="meta">0</div></div><div id="paymentRows" class="rows"></div></section>

    <section class="card"><button id="refToggle" class="disclose"><span>Referrals <b id="refCount">0</b></span><span>⌄</span></button><div id="refRows" class="rows hidden"></div></section>
    <section class="card"><button id="withdrawToggle" class="disclose"><span>Payout history <b id="withdrawCount">0</b></span><span>⌄</span></button><div id="withdrawRows" class="rows hidden"></div></section>
  </div>
</main>
<script>
const key='ar_payment_device_token_v1';
const token=localStorage.getItem(key)||'';
const q=new URLSearchParams(location.search);
const affiliate=q.get('affiliate')||'';
const request=q.get('request')||'';
const $=id=>document.getElementById(id);
const money=v=>'RM'+(Number(v||0)||0).toFixed(2);
const date=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'-':new Intl.DateTimeFormat('en-MY',{day:'numeric',month:'short',year:'numeric'}).format(d)};
const headers=()=>{const h={'Content-Type':'application/json'};if(token)h['X-PayPing-Device-Token']=token;return h};
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function rowLabel(username,userId){return username?'@'+username:'ID '+userId}
function payoutHtml(payout){
  if(!payout?.configured||payout?.readable===false)return '<div class="empty">No payout method configured.</div>';
  const d=payout.details||{};
  if(payout.method==='DUITNOW'){
    return '<div class="mini"><div class="k">DuitNow</div><div class="v">'+esc(d.identifierType||'-')+' · '+esc(d.identifier||'-')+'</div><div class="meta" style="margin-top:5px">'+esc(d.accountName||'-')+'</div></div>';
  }
  if(payout.method==='BANK'){
    return '<div class="mini"><div class="k">Bank Transfer</div><div class="v">'+esc(d.bankName||'-')+'</div><div class="meta" style="margin-top:5px">'+esc(d.accountName||'-')+' · '+esc(d.accountNumber||'-')+'</div></div>';
  }
  return '<div class="empty">'+esc(payout.displayHint||payout.method||'Payout configured')+'</div>';
}
function renderAudit(a){
  if(!a||!a.exists){$('auditCard').classList.add('hidden');return}
  $('auditCard').classList.remove('hidden');
  $('auditAmount').textContent=money(a.requestedAmount);
  $('auditCalc').textContent=money(a.calculatedAmount);
  $('auditPayments').textContent=String(a.paymentCount||0);
  const ok=Boolean(a.verified);
  $('auditCard').classList.toggle('bad',!ok);
  $('auditPill').textContent=ok?'Verified ✓':'Mismatch';
  $('auditPill').className='pill '+(ok?'':'bad');
  $('auditMismatch').classList.toggle('hidden',ok);
  $('auditMismatch').textContent=ok?'':'Difference '+money(a.differenceAmount)+' · '+String(a.invalidCount||0)+' invalid checks';
  $('markPaid').disabled=!a.canMarkPaid;
  $('auditActions').classList.toggle('hidden',a.status!=='PENDING');
}
function render(d){
  const p=d.profile||{},s=d.summary||{};
  $('title').textContent=p.label||'Affiliate';
  $('sub').textContent=p.referralCode?'Referral '+p.referralCode:'Affiliate detail';
  $('earned').textContent=money(s.totalEarned);$('sales').textContent=money(s.grossSales)+' sales generated';
  $('refs').textContent=String(s.referrals||0);$('paying').textContent=String(s.payingReferrals||0);$('payments').textContent=String(s.paymentCount||0);
  $('pending').textContent=money(s.pending);$('available').textContent=money(s.available);$('withdrawing').textContent=money(s.withdrawing);$('paid').textContent=money(s.paid);
  $('payoutHint').textContent=d.payoutProfile?.configured?(d.payoutProfile.displayHint||d.payoutProfile.method):'No payout method';
  $('payoutDetail').innerHTML=payoutHtml(d.payoutProfile);
  renderAudit(d.audit);

  const commissions=d.commissions||[];$('paymentCount').textContent=String(commissions.length);
  $('paymentRows').innerHTML=commissions.length?commissions.map(c=>{
    const href='/ar-payment/transaction?order='+encodeURIComponent(c.orderNumber);
    return '<a class="row" href="'+href+'"><div class="row-main"><div class="name">'+esc(rowLabel(c.buyerUsername,c.referredUserId))+'</div><div class="meta">'+date(c.createdAt)+' · '+esc(c.status)+'</div></div><div class="row-side"><div class="amount">'+money(c.grossAmount)+'</div><div class="commission">+'+money(c.commissionAmount)+'</div></div></a>';
  }).join(''):'<div class="empty">Belum ada payment.</div>';

  const refs=d.referrals||[];$('refCount').textContent=String(refs.length);
  $('refRows').innerHTML=refs.length?refs.map(r=>'<div class="row"><div class="row-main"><div class="name">'+esc(r.label)+'</div><div class="meta">'+(r.paying?String(r.paymentCount)+' payments':'Belum bayar')+'</div></div><div class="row-side"><div class="amount">'+money(r.grossSales)+'</div><div class="commission">'+money(r.commissionGenerated)+' commission</div></div></div>').join(''):'<div class="empty">Belum ada referral.</div>';

  const ws=d.withdrawals||[];$('withdrawCount').textContent=String(ws.length);
  $('withdrawRows').innerHTML=ws.length?ws.map(w=>{const href='/ar-payment/affiliate/admin/detail?affiliate='+encodeURIComponent(p.userId)+'&request='+encodeURIComponent(w.requestId);return '<a class="row" href="'+href+'"><div class="row-main"><div class="name">'+esc(w.requestId)+'</div><div class="meta">'+date(w.createdAt)+'</div></div><div class="row-side"><div class="amount">'+money(w.amount)+'</div><div class="status">'+esc(w.status)+'</div></div></a>'}).join(''):'<div class="empty">Belum ada payout.</div>';
}
function toggle(id){$(id).classList.toggle('hidden')}
$('refToggle').onclick=()=>toggle('refRows');$('withdrawToggle').onclick=()=>toggle('withdrawRows');
async function load(){
  if(!affiliate){$('loading').innerHTML='<div class="error">Affiliate ID missing.</div>';return}
  try{
    let url='/api/affiliate-admin?affiliate='+encodeURIComponent(affiliate);
    if(request)url+='&request='+encodeURIComponent(request);
    const r=await fetch(url,{headers:headers()});const x=await r.json();
    if(r.status===401){location.replace('/ar-payment/login');return}if(r.status===403){$('loading').hidden=true;$('blocked').hidden=false;return}
    if(!r.ok||!x.ok)throw new Error(x.message||'Affiliate detail gagal.');
    $('loading').hidden=true;$('app').hidden=false;render(x.detail);
  }catch(e){$('loading').innerHTML='<div class="error">'+esc(e.message||String(e))+'</div>'}
}
async function finalize(decision){
  if(!request)return;
  const verb=decision==='PAID'?'Mark payout as PAID?':'Reject payout request?';
  if(!confirm(verb))return;
  $('markPaid').disabled=true;$('reject').disabled=true;$('auditMsg').textContent='Checking ledger…';
  try{
    const r=await fetch('/api/affiliate-admin',{method:'POST',headers:headers(),body:JSON.stringify({action:'finalize_withdrawal',requestId:request,decision})});
    const x=await r.json();
    if(!r.ok||!x.ok)throw new Error(x.message||x.error||'Update gagal.');
    $('auditMsg').textContent=decision==='PAID'?'Paid ✓':'Rejected';$('auditMsg').className='msg ok';
    await load();
  }catch(e){$('auditMsg').textContent=e.message||String(e);$('auditMsg').className='msg bad';$('reject').disabled=false;await load()}
}
$('markPaid').onclick=()=>finalize('PAID');$('reject').onclick=()=>finalize('REJECTED');
load();
</script>
</body>
</html>`;

function send(res,type,body){res.statusCode=200;res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');res.end(body)}
export default function affiliateAdminDetailPageHandler(req,res){
  if(req.method!=='GET'&&req.method!=='HEAD')return res.status(405).send('Method Not Allowed');
  return send(res,'text/html; charset=utf-8',req.method==='HEAD'?'':PAGE);
}
