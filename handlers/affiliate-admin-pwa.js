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
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 0,#28124f 0,#11111b 38%,#07070d 100%);color:#f8f8fb;padding:env(safe-area-inset-top) 16px calc(16px + env(safe-area-inset-right)) calc(30px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left))}
    main{max-width:680px;margin:0 auto;padding:22px 0 36px}.top{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:16px}.brand{display:flex;align-items:center;gap:10px}.logo{width:42px;height:42px;border-radius:13px;overflow:hidden}.logo img{width:100%;height:100%}.title{font-size:20px;font-weight:900}.sub{font-size:12px;color:#949bad}.back{padding:9px 11px;border-radius:12px;background:#1d2130;color:#ddd4ff;text-decoration:none;font-size:13px;font-weight:800}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:13px}.stat{padding:14px;background:rgba(19,22,31,.88);border:1px solid rgba(255,255,255,.07);border-radius:17px}.k{font-size:11px;color:#8f96a8}.v{font-size:20px;font-weight:900;margin-top:6px}
    .card{background:rgba(19,22,31,.88);border:1px solid rgba(255,255,255,.07);border-radius:20px;padding:16px;margin-bottom:13px}.card-title{font-weight:900;margin-bottom:11px}.list{display:flex;flex-direction:column;gap:9px}.item{padding:13px;background:#0b0e15;border:1px solid rgba(255,255,255,.06);border-radius:14px}.line{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.name{font-weight:850;font-size:14px}.amount{font-size:17px;font-weight:900}.meta{font-size:11px;color:#888f9e;margin-top:5px;line-height:1.5}.badge{display:inline-block;padding:3px 7px;border-radius:999px;font-size:10px;font-weight:850;background:#2a2f3a;color:#c9cfda}.badge.pending{background:rgba(255,191,65,.14);color:#ffd17d}.badge.paid{background:rgba(57,217,138,.14);color:#75e3a7}.badge.rejected{background:rgba(255,90,90,.14);color:#ffa0a0}
    .actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:11px}button{border:0;border-radius:11px;padding:11px 10px;color:#fff;font-weight:850;background:linear-gradient(135deg,#8b5cf6,#6d28d9)}button.reject{background:#34212a;color:#ffaaaa}button:disabled{opacity:.45}.empty{padding:18px;text-align:center;color:#7f8797;font-size:13px}.msg{font-size:12px;color:#aeb5c3;min-height:17px;margin-top:9px}.msg.bad{color:#ff9f9f}.msg.ok{color:#79e4ad}.error{padding:17px;border-radius:17px;background:rgba(255,70,70,.08);border:1px solid rgba(255,100,100,.18);color:#ffc1c1}.loader{text-align:center;padding:35px;color:#aab0bd}
    @media(min-width:620px){.grid{grid-template-columns:repeat(4,1fr)}}
  </style>
</head>
<body>
<main>
  <div class="top"><div class="brand"><div class="logo"><img src="/ar-payment/payping-icon-v4.svg"></div><div><div class="title">Affiliate Admin</div><div class="sub">PayPing owner payout console</div></div></div><a class="back" href="/ar-payment/affiliate">Affiliate</a></div>
  <div id="loading" class="loader">Loading admin…</div>
  <div id="blocked" class="error" hidden>Owner access sahaja.</div>
  <div id="app" hidden>
    <section class="grid">
      <div class="stat"><div class="k">Affiliates</div><div id="affiliates" class="v">0</div></div>
      <div class="stat"><div class="k">Pending Requests</div><div id="pendingCount" class="v">0</div></div>
      <div class="stat"><div class="k">Pending Payout</div><div id="pendingAmount" class="v">RM0.00</div></div>
      <div class="stat"><div class="k">Paid Out</div><div id="paidAmount" class="v">RM0.00</div></div>
    </section>
    <section class="card">
      <div class="card-title">Commission Overview</div>
      <div class="line"><span class="meta">Total commission</span><strong id="totalCommission">RM0.00</strong></div>
      <div class="line" style="margin-top:8px"><span class="meta">Available in user wallets</span><strong id="availableCommission">RM0.00</strong></div>
      <div class="line" style="margin-top:8px"><span class="meta">Withdrawing</span><strong id="withdrawingCommission">RM0.00</strong></div>
    </section>
    <section class="card">
      <div class="card-title">Withdrawal Requests</div>
      <div id="list" class="list"></div>
      <div id="msg" class="msg"></div>
    </section>
  </div>
</main>
<script>
const key='ar_payment_device_token_v1';
const token=localStorage.getItem(key)||'';
const $=id=>document.getElementById(id);
let state=null;
const money=v=>'RM'+(Number(v||0)||0).toFixed(2);
const date=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'-':new Intl.DateTimeFormat('en-MY',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}).format(d)};
const headers=()=>({Authorization:'Bearer '+token,'Content-Type':'application/json'});
function setMsg(t,c=''){$('msg').textContent=t||'';$('msg').className='msg '+c}
function badge(s){const v=String(s||'').toLowerCase();return '<span class="badge '+v+'">'+String(s||'-')+'</span>'}
function render(){
  const s=state.summary||{};
  $('affiliates').textContent=s.affiliates||0;
  $('pendingCount').textContent=s.pendingWithdrawalCount||0;
  $('pendingAmount').textContent=money(s.pendingWithdrawalAmount);
  $('paidAmount').textContent=money(s.paidWithdrawalAmount);
  $('totalCommission').textContent=money(s.totalCommission);
  $('availableCommission').textContent=money(s.availableCommission);
  $('withdrawingCommission').textContent=money(s.withdrawingCommission);
  const rows=state.withdrawals||[];
  $('list').innerHTML=rows.length?rows.map(w=>{
    const who=w.username?'@'+w.username:'ID '+w.userId;
    const actions=w.status==='PENDING'
      ? '<div class="actions"><button data-id="'+w.requestId+'" data-decision="PAID">Mark Paid</button><button class="reject" data-id="'+w.requestId+'" data-decision="REJECTED">Reject</button></div>'
      : '';
    return '<div class="item"><div class="line"><div><div class="name">'+who+'</div><div class="meta">'+w.requestId+' · '+date(w.createdAt)+'</div></div><div style="text-align:right"><div class="amount">'+money(w.amount)+'</div>'+badge(w.status)+'</div></div>'+actions+'</div>';
  }).join(''):'<div class="empty">Belum ada withdrawal request.</div>';
  document.querySelectorAll('[data-decision]').forEach(btn=>btn.onclick=()=>finalize(btn.dataset.id,btn.dataset.decision));
}
async function load(){
  if(!token){$('loading').hidden=true;$('blocked').hidden=false;return}
  try{
    const r=await fetch('/api/affiliate-admin',{headers:headers()});
    const d=await r.json();
    if(r.status===401||r.status===403){$('loading').hidden=true;$('blocked').hidden=false;return}
    if(!r.ok||!d.ok)throw new Error(d.message||'Admin dashboard gagal.');
    state=d;$('loading').hidden=true;$('app').hidden=false;render();
  }catch(e){$('loading').innerHTML='<div class="error">'+(e.message||String(e))+'</div>'}
}
async function finalize(id,decision){
  if(!confirm((decision==='PAID'?'Mark PAID ':'Reject ')+id+'?'))return;
  try{
    document.querySelectorAll('button').forEach(b=>b.disabled=true);setMsg('Updating…');
    const r=await fetch('/api/affiliate-admin',{method:'POST',headers:headers(),body:JSON.stringify({action:'finalize_withdrawal',requestId:id,decision})});
    const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.message||d.error||'Update gagal.');
    state=d;setMsg(id+' → '+(d.result?.status||decision)+' ✅','ok');render();
  }catch(e){setMsg(e.message||String(e),'bad');render()}
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
