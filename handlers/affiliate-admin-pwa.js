const PAGE = String.raw`<!doctype html>
<html lang="ms">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#6d28d9">
  <title>PayPing! Affiliate Admin</title>
  <link rel="manifest" href="/ar-payment/payping-v4.webmanifest">
  <link rel="icon" href="/ar-payment/payping-icon-v4.svg">
  <style>
    :root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 0,#28124f 0,#11111b 38%,#07070d 100%);color:#f8f8fb;padding:env(safe-area-inset-top) 16px calc(16px + env(safe-area-inset-right)) calc(30px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left))}
    main{max-width:680px;margin:0 auto;padding:22px 0 36px}
    .top{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:18px}
    .brand{display:flex;align-items:center;gap:10px}.logo{width:42px;height:42px;border-radius:13px;overflow:hidden}.logo img{width:100%;height:100%;display:block}
    .title{font-size:20px;font-weight:900}.sub{font-size:12px;color:#949bad;margin-top:2px}.back{padding:9px 12px;border-radius:12px;background:#1d2130;color:#ddd4ff;text-decoration:none;font-size:13px;font-weight:800}
    .overview{display:grid;grid-template-columns:1.35fr 1fr;gap:10px;margin-bottom:18px}.metric{background:rgba(19,22,31,.88);border:1px solid rgba(255,255,255,.07);border-radius:19px;padding:15px}.metric .k{font-size:11px;color:#8f96a8}.metric .v{font-size:25px;font-weight:900;margin-top:5px;letter-spacing:-.6px}.metric.small .v{font-size:20px}
    .section{margin-top:19px}.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 2px 9px}.section-title{font-size:15px;font-weight:900}.count{font-size:11px;font-weight:850;color:#a998e8;background:rgba(124,77,255,.12);border:1px solid rgba(160,123,255,.16);padding:5px 8px;border-radius:999px}
    .list{overflow:hidden;border:1px solid rgba(255,255,255,.07);border-radius:19px;background:rgba(19,22,31,.82)}
    .row{min-height:70px;display:flex;align-items:center;gap:12px;padding:12px 14px;text-decoration:none;color:inherit;border-bottom:1px solid rgba(255,255,255,.055)}.row:last-child{border-bottom:0}.row:active{background:rgba(255,255,255,.035)}
    .avatar{width:38px;height:38px;flex:0 0 38px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(145deg,rgba(139,92,246,.35),rgba(66,35,123,.5));font-size:14px;font-weight:900;color:#e6ddff}
    .row-main{min-width:0;flex:1}.name{font-size:14px;font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meta{font-size:11px;color:#858d9e;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .row-side{text-align:right;flex:0 0 auto}.amount{font-size:15px;font-weight:900}.side-label{font-size:10px;color:#777f90;margin-top:3px}.chev{font-size:20px;color:#625b73;margin-left:1px}
    .badge{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:850;padding:5px 8px;border-radius:999px;background:#292e39;color:#cdd3df}.badge.pending{background:rgba(252,190,58,.13);color:#ffd273}.badge.paid{background:rgba(57,217,138,.14);color:#78e3ad}.badge.rejected{background:rgba(255,94,94,.13);color:#ff9c9c}
    .empty{padding:22px 16px;text-align:center;color:#7f8797;font-size:13px}.loader{text-align:center;padding:38px;color:#aab0bd}.error{padding:17px;border-radius:17px;background:rgba(255,70,70,.08);border:1px solid rgba(255,100,100,.18);color:#ffc1c1}
    .footnote{font-size:11px;color:#626979;margin:10px 3px 0}
    /* PAYPING_MOBILE_REFERENCE_V1 */
    @media(max-width:619px){
      :root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Segoe UI",sans-serif}
      body{padding:0;overflow:hidden;background-attachment:fixed;background-size:100vw 100vh;background-repeat:no-repeat}
      body::before{content:"";position:fixed;z-index:1000;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 18px);height:1px;background:rgba(255,255,255,.06);pointer-events:none}
      main{position:fixed;top:calc(env(safe-area-inset-top,0px) + 19px);left:calc(18px + env(safe-area-inset-left));right:calc(18px + env(safe-area-inset-right));bottom:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px 0 calc(28px + env(safe-area-inset-bottom))}
      .title{font-size:24px;line-height:1.08}.sub{font-size:13px;line-height:1.3}
      .overview{grid-template-columns:1.25fr 1fr}.metric{padding:14px}.metric .v{font-size:23px}
    }
    /* PAYPING_UX_POLISH_V2 */
    html{-webkit-text-size-adjust:100%;text-size-adjust:100%}body{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
    a,button,input,select{-webkit-tap-highlight-color:transparent}a,button,.row,.back{touch-action:manipulation}
    @media(max-width:619px){
      main{scrollbar-width:none;overscroll-behavior-y:contain;scroll-padding-bottom:calc(104px + env(safe-area-inset-bottom))}main::-webkit-scrollbar{display:none}
      button,.back,.row{min-height:44px}.row,.metric,.back{transition:transform .14s ease,opacity .14s ease,border-color .16s ease,background-color .16s ease}.row:active,.back:active{transform:scale(.985)}
      input,select,textarea{font-size:16px}.amount,.v{font-variant-numeric:tabular-nums}
    }
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}}
  </style>
</head>
<body>
<main>
  <div class="top">
    <div class="brand"><div class="logo"><img src="/ar-payment/payping-icon-v4.svg" alt=""></div><div><div class="title">Affiliate Admin</div><div class="sub">Review earnings & payouts</div></div></div>
    <a class="back" href="/ar-payment/affiliate">Done</a>
  </div>
  <div id="loading" class="loader">Loading…</div>
  <div id="blocked" class="error" hidden>Owner access sahaja.</div>
  <div id="app" hidden>
    <section class="overview">
      <div class="metric"><div class="k">Total commission</div><div id="totalCommission" class="v">RM0.00</div></div>
      <div class="metric small"><div class="k">Paid out</div><div id="paidAmount" class="v">RM0.00</div></div>
    </section>

    <section class="section">
      <div class="section-head"><div class="section-title">Affiliates</div><div id="affiliateCount" class="count">0</div></div>
      <div id="affiliateList" class="list"></div>
    </section>

    <section class="section">
      <div class="section-head"><div class="section-title">Payout requests</div><div id="pendingCount" class="count">0 pending</div></div>
      <div id="payoutList" class="list"></div>
      <div class="footnote">Tap a payout to verify the ledger before marking it paid.</div>
    </section>
  </div>
</main>
<script>
const key='ar_payment_device_token_v1';
const token=localStorage.getItem(key)||'';
const $=id=>document.getElementById(id);
const money=v=>'RM'+(Number(v||0)||0).toFixed(2);
const date=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'-':new Intl.DateTimeFormat('en-MY',{day:'numeric',month:'short',year:'numeric'}).format(d)};
const headers=()=>{const h={'Content-Type':'application/json'};if(token)h['X-PayPing-Device-Token']=token;return h};
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function initial(v){const s=String(v||'A').replace(/^@/,'').trim();return (s[0]||'A').toUpperCase()}
function badge(s){const v=String(s||'').toLowerCase();return '<span class="badge '+esc(v)+'">'+esc(String(s||'-'))+'</span>'}
function render(d){
  const s=d.summary||{};
  $('totalCommission').textContent=money(s.totalCommission);
  $('paidAmount').textContent=money(s.paidWithdrawalAmount);
  $('affiliateCount').textContent=String(s.affiliates||0);
  $('pendingCount').textContent=String(s.pendingWithdrawalCount||0)+' pending';

  const affiliates=d.affiliates||[];
  $('affiliateList').innerHTML=affiliates.length?affiliates.map(a=>{
    const href='/ar-payment/affiliate/admin/detail?affiliate='+encodeURIComponent(a.userId);
    return '<a class="row" href="'+href+'"><div class="avatar">'+esc(initial(a.label))+'</div><div class="row-main"><div class="name">'+esc(a.label)+'</div><div class="meta">'+esc(a.payingReferrals)+' paying · '+esc(a.referrals)+' referrals</div></div><div class="row-side"><div class="amount">'+money(a.totalEarned)+'</div><div class="side-label">earned</div></div><div class="chev">›</div></a>';
  }).join(''):'<div class="empty">Belum ada affiliate.</div>';

  const payouts=(d.withdrawals||[]).filter(w=>w.status==='PENDING').concat((d.withdrawals||[]).filter(w=>w.status!=='PENDING').slice(0,6));
  $('payoutList').innerHTML=payouts.length?payouts.map(w=>{
    const href='/ar-payment/affiliate/admin/detail?affiliate='+encodeURIComponent(w.userId)+'&request='+encodeURIComponent(w.requestId);
    return '<a class="row" href="'+href+'"><div class="row-main"><div class="name">'+esc(w.label)+'</div><div class="meta">'+esc(w.requestId)+' · '+date(w.createdAt)+'</div></div><div class="row-side"><div class="amount">'+money(w.amount)+'</div>'+badge(w.status)+'</div><div class="chev">›</div></a>';
  }).join(''):'<div class="empty">Belum ada payout request.</div>';
}
async function load(){
  try{
    const r=await fetch('/api/affiliate-admin',{headers:headers()});
    const d=await r.json();
    if(r.status===401){location.replace('/ar-payment/login');return}
    if(r.status===403){$('loading').hidden=true;$('blocked').hidden=false;return}
    if(!r.ok||!d.ok)throw new Error(d.message||'Admin dashboard gagal.');
    $('loading').hidden=true;$('app').hidden=false;render(d);
  }catch(e){$('loading').innerHTML='<div class="error">'+esc(e.message||String(e))+'</div>'}
}
load();
</script>
</body>
</html>`;

function send(res,type,body){res.statusCode=200;res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');res.end(body)}
export default function affiliateAdminPageHandler(req,res){
  if(req.method!=='GET'&&req.method!=='HEAD')return res.status(405).send('Method Not Allowed');
  return send(res,'text/html; charset=utf-8',req.method==='HEAD'?'':PAGE);
}
