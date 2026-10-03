const PAGE = String.raw`<!doctype html>
<html lang="ms">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#6d28d9">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="PayPing!">
  <title>PayPing! Affiliate</title>
  <link rel="manifest" href="/ar-payment/payping-v4.webmanifest">
  <link rel="icon" href="/ar-payment/payping-icon-v4.svg">
  <style>
    :root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;background:radial-gradient(circle at 18% 0,#27114e 0,#11111b 38%,#07070d 100%);color:#f8f8fb;padding:env(safe-area-inset-top) 16px calc(16px + env(safe-area-inset-right)) calc(92px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left))}
    main{max-width:620px;margin:0 auto;padding:24px 0 32px}
    .top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}.brand{display:flex;align-items:center;gap:11px}.logo{width:44px;height:44px;border-radius:14px;overflow:hidden;flex:0 0 44px}.logo img{width:100%;height:100%;display:block}.title{font-size:21px;font-weight:850}.sub{font-size:12px;color:#969cac;margin-top:2px}
    .back{color:#d7cdfd;text-decoration:none;font-size:14px;font-weight:750;padding:9px 11px;border:1px solid rgba(255,255,255,.09);border-radius:12px;background:rgba(255,255,255,.04)}.admin-link{display:none;margin-top:8px;color:#d9d0ff;text-decoration:none;font-size:12px;font-weight:800}
    .hero{position:relative;overflow:hidden;background:linear-gradient(145deg,rgba(132,75,255,.26),rgba(35,22,72,.74));border:1px solid rgba(164,126,255,.22);border-radius:24px;padding:21px;box-shadow:0 22px 70px rgba(0,0,0,.3);margin-bottom:14px}.hero:after{content:"";position:absolute;width:190px;height:190px;border-radius:50%;right:-90px;top:-100px;background:radial-gradient(circle,rgba(114,255,175,.16),transparent 68%)}
    .eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#bba7ff;font-weight:800}.available{font-size:38px;font-weight:900;letter-spacing:-1px;margin:7px 0 3px}.hint{font-size:13px;color:#b7bdca}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}.stat{background:rgba(19,22,31,.84);border:1px solid rgba(255,255,255,.075);border-radius:18px;padding:15px;min-height:91px}.stat .k{font-size:12px;color:#8f96a8}.stat .v{font-size:22px;font-weight:850;margin-top:7px}.stat .v.smallv{font-size:18px}
    .card{background:rgba(19,22,31,.86);border:1px solid rgba(255,255,255,.075);border-radius:21px;padding:18px;box-shadow:0 18px 54px rgba(0,0,0,.24);margin-bottom:13px}.card-title{font-weight:850;font-size:16px;margin-bottom:12px}.row{display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.055);font-size:14px}.row:last-child{border-bottom:0}.row span:first-child{color:#9ea5b4}.row strong{text-align:right}
    .refbox{background:#0b0e15;border:1px solid #2a2f3c;border-radius:14px;padding:12px 13px;font-size:13px;color:#c9d0db;word-break:break-all;line-height:1.45}.actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:10px}
    button,.btn{border:0;border-radius:14px;padding:13px 14px;font-size:14px;font-weight:850;color:#fff;background:linear-gradient(135deg,#9b6bff,#6d28d9);text-decoration:none;text-align:center}.secondary{background:#202532}.green{background:linear-gradient(135deg,#2ba66d,#207e56)}button:disabled{opacity:.42}
    .withdraw{width:100%;margin-top:12px;font-size:15px}.msg{font-size:13px;line-height:1.45;margin-top:10px;min-height:18px;color:#aeb5c4}.msg.bad{color:#ff9a9a}.msg.ok{color:#75e3a7}
    .tabs{display:flex;gap:7px;margin-bottom:10px}.tab{flex:1;background:#171b24;color:#aeb4c2;margin:0;padding:10px}.tab.active{background:#30244e;color:#fff;box-shadow:inset 0 0 0 1px rgba(160,123,255,.35)}
    .list{display:flex;flex-direction:column;gap:8px}.item{background:#0c0f16;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:12px}.item-top{display:flex;justify-content:space-between;gap:12px;align-items:center}.item-title{font-size:14px;font-weight:800}.amount{font-size:15px;font-weight:900}.meta{font-size:11px;color:#828999;margin-top:6px;display:flex;gap:8px;flex-wrap:wrap}.badge{font-size:10px;font-weight:850;padding:4px 7px;border-radius:999px;background:#282d38;color:#c6ccd8}.badge.available,.badge.paid{background:rgba(57,217,138,.14);color:#78e3ad}.badge.pending,.badge.withdrawal_pending{background:rgba(252,190,58,.13);color:#ffd273}.badge.rejected{background:rgba(255,94,94,.13);color:#ff9c9c}
    .empty{padding:18px;text-align:center;color:#7f8797;font-size:13px}.loader{padding:35px;text-align:center;color:#aab0bd}.error{background:rgba(255,80,80,.08);border:1px solid rgba(255,100,100,.18);border-radius:18px;padding:18px;color:#ffc0c0;line-height:1.45}
    .formgrid{display:grid;grid-template-columns:1fr;gap:9px}.field label{display:block;font-size:11px;color:#8d95a5;margin:0 0 6px}.pinput,.pselect{width:100%;background:#0b0e15;border:1px solid #2a303d;border-radius:12px;padding:12px;color:#fff;font-size:14px;outline:none}.pinput:focus,.pselect:focus{border-color:#8b5cf6}.payout-summary{font-size:12px;color:#9fa7b7;margin:8px 0 0}.save-payout{width:100%;margin-top:10px}
    nav{position:fixed;z-index:20;left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom));width:min(92%,560px);height:62px;border:1px solid rgba(255,255,255,.08);background:rgba(18,20,29,.9);backdrop-filter:blur(18px);border-radius:19px;display:grid;grid-template-columns:1fr 1fr;padding:6px;box-shadow:0 18px 55px rgba(0,0,0,.4)}nav a{display:flex;flex-direction:column;align-items:center;justify-content:center;text-decoration:none;color:#7f8797;font-size:11px;font-weight:750;gap:3px;border-radius:14px}nav a.active{color:#fff;background:rgba(126,77,255,.18)}nav b{font-size:19px;line-height:1}
    @media(min-width:560px){.grid{grid-template-columns:repeat(4,1fr)}.stat{min-height:100px}.stat .v{font-size:19px}}
  </style>
</head>
<body>
<main>
  <div class="top">
    <div class="brand"><div class="logo"><img src="/ar-payment/payping-icon-v4.svg" alt=""></div><div><div class="title">PayPing! Affiliate</div><div class="sub">Earn from successful referrals</div></div></div>
    <div style="text-align:right"><a class="back" href="/ar-payment/">PayPing</a><a id="adminLink" class="admin-link" href="/ar-payment/affiliate/admin">Admin</a></div>
  </div>

  <div id="loading" class="loader">Loading affiliate wallet…</div>
  <div id="connect" class="error" hidden>PayPing device belum connected. Buka PayPing dan buat <b>/pushsetup</b> dulu.<div style="margin-top:12px"><a class="btn" href="/ar-payment/">Open PayPing</a></div></div>

  <div id="app" hidden>
    <section class="hero"><div class="eyebrow">Available balance</div><div id="available" class="available">RM0.00</div><div id="withdrawHint" class="hint">Minimum withdraw RM20.00</div></section>

    <section class="grid">
      <div class="stat"><div class="k">Pending</div><div id="pending" class="v">RM0.00</div></div>
      <div class="stat"><div class="k">Withdrawing</div><div id="withdrawing" class="v">RM0.00</div></div>
      <div class="stat"><div class="k">Total Earned</div><div id="earned" class="v">RM0.00</div></div>
      <div class="stat"><div class="k">Paid Out</div><div id="paid" class="v">RM0.00</div></div>
    </section>

    <section class="card">
      <div class="card-title">Affiliate Overview</div>
      <div class="row"><span>Referrals</span><strong id="referrals">0</strong></div>
      <div class="row"><span>Paying Referrals</span><strong id="payingReferrals">0</strong></div>
      <div class="row"><span>Commission</span><strong id="commission">20%</strong></div>
      <div class="row"><span>Hold Period</span><strong id="hold">7 hari</strong></div>
      <div class="row"><span>Minimum Withdraw</span><strong id="minimum">RM20.00</strong></div>
    </section>

    <section class="card">
      <div class="card-title">Referral Link</div>
      <div id="refLink" class="refbox">Generating link…</div>
      <div class="actions"><button id="copy" class="secondary">Copy Link</button><button id="share">Share Link</button></div>
    </section>

    <section class="card">
      <div class="card-title">Payout Method</div>
      <div class="formgrid">
        <div class="field"><label>Method</label><select id="payoutMethod" class="pselect"><option value="DUITNOW">DuitNow</option><option value="BANK">Bank Transfer</option></select></div>
        <div class="field"><label>Account Holder Name</label><input id="payoutName" class="pinput" maxlength="100" placeholder="Nama pemilik akaun"></div>
        <div id="duitnowFields" class="formgrid">
          <div class="field"><label>DuitNow Type</label><select id="duitnowType" class="pselect"><option value="PHONE">Phone</option><option value="NRIC">NRIC</option><option value="BUSINESS">Business Registration</option></select></div>
          <div class="field"><label>DuitNow ID</label><input id="duitnowId" class="pinput" maxlength="80" placeholder="Contoh: 60123456789"></div>
        </div>
        <div id="bankFields" class="formgrid" hidden>
          <div class="field"><label>Bank</label><input id="bankName" class="pinput" maxlength="80" placeholder="Contoh: Maybank"></div>
          <div class="field"><label>Account Number</label><input id="bankAccount" class="pinput" maxlength="80" inputmode="numeric" placeholder="Nombor akaun"></div>
        </div>
      </div>
      <button id="savePayout" class="save-payout secondary">Save Payout Details</button>
      <div id="payoutStatus" class="payout-summary">Belum configured.</div>
    </section>

    <section class="card">
      <div class="card-title">Withdraw</div>
      <div class="hint">Available commission akan dikunci selepas request dibuat untuk elak duplicate withdrawal.</div>
      <button id="withdraw" class="withdraw green" disabled>Withdraw</button>
      <div id="msg" class="msg"></div>
    </section>

    <section class="card">
      <div class="card-title">Activity</div>
      <div class="tabs"><button id="commissionTab" class="tab active">Commission</button><button id="withdrawTab" class="tab">Withdrawals</button></div>
      <div id="activity" class="list"></div>
    </section>
  </div>
</main>
<nav><a href="/ar-payment/"><b>⌂</b><span>PayPing</span></a><a href="/ar-payment/affiliate" class="active"><b>₿</b><span>Earn</span></a></nav>

<script>
const deviceKey='ar_payment_device_token_v1';
const token=localStorage.getItem(deviceKey)||'';
const $=id=>document.getElementById(id);
let state=null;
let tab='commission';

function money(v){const n=Number(v||0);return 'RM'+(Number.isFinite(n)?n:0).toFixed(2)}
function dateText(v){if(!v)return '-';const d=new Date(v);if(Number.isNaN(d.getTime()))return '-';return new Intl.DateTimeFormat('en-MY',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}).format(d)}
function setMsg(text,type=''){$('msg').textContent=text||'';$('msg').className='msg '+type}
function badge(s){const value=String(s||'').toLowerCase();return '<span class="badge '+value+'">'+String(s||'-').replaceAll('_',' ')+'</span>'}
function auth(){return {Authorization:'Bearer '+token,'Content-Type':'application/json'}}
function togglePayoutFields(){
  const method=$('payoutMethod').value;
  $('duitnowFields').hidden=method!=='DUITNOW';
  $('bankFields').hidden=method!=='BANK';
}
function renderPayoutProfile(){
  const p=state?.payoutProfile||{configured:false};
  if(p.configured&&p.readable!==false){
    $('payoutMethod').value=p.method||'DUITNOW';
    const d=p.details||{};
    $('payoutName').value=d.accountName||'';
    $('duitnowType').value=d.identifierType||'PHONE';
    $('duitnowId').value=d.identifier||'';
    $('bankName').value=d.bankName||'';
    $('bankAccount').value=d.accountNumber||'';
    $('payoutStatus').textContent='Saved: '+(p.displayHint||p.method||'Configured')+' ✅';
  }else{
    $('payoutStatus').textContent=p.configured?'Saved details tidak dapat dibaca. Save semula payout details.':'Belum configured. Save payout details sebelum withdraw.';
  }
  togglePayoutFields();
}

function renderActivity(){
  const list=$('activity');
  const data=tab==='commission'?(state?.activity?.commissions||[]):(state?.activity?.withdrawals||[]);
  if(!data.length){list.innerHTML='<div class="empty">Belum ada activity.</div>';return}
  list.innerHTML=data.map(item=>{
    if(tab==='commission'){
      return '<div class="item"><div class="item-top"><div class="item-title">Referral commission</div><div class="amount">+'+money(item.commissionAmount)+'</div></div><div class="meta">'+badge(item.status)+'<span>'+item.ratePercent+'% of '+money(item.grossAmount)+'</span><span>'+dateText(item.createdAt)+'</span></div></div>'
    }
    return '<div class="item"><div class="item-top"><div class="item-title">'+item.requestId+'</div><div class="amount">'+money(item.amount)+'</div></div><div class="meta">'+badge(item.status)+'<span>'+dateText(item.createdAt)+'</span></div></div>'
  }).join('')
}

function render(){
  const d=state.dashboard;
  $('available').textContent=money(d.available);
  $('pending').textContent=money(d.pending);
  $('withdrawing').textContent=money(d.withdrawing);
  $('earned').textContent=money(d.totalEarned);
  $('paid').textContent=money(d.paid);
  $('referrals').textContent=d.referrals;
  $('payingReferrals').textContent=d.payingReferrals;
  $('commission').textContent=d.commissionPercent+'%';
  $('hold').textContent=d.holdDays+' hari';
  $('minimum').textContent=money(d.minimumWithdrawal);
  $('withdrawHint').textContent='Minimum withdraw '+money(d.minimumWithdrawal);
  $('refLink').textContent=state.referralLink||'Referral link belum tersedia.';
  $('withdraw').disabled=!state.withdrawAllowed;
  const enough=Number(d.available||0)>=Number(d.minimumWithdrawal||0);
  $('withdraw').textContent=state.withdrawAllowed
    ? 'Withdraw '+money(d.available)
    : (enough?'Setup payout first':'Minimum '+money(d.minimumWithdrawal));
  renderPayoutProfile();
  renderActivity();
}

async function probeAdmin(){
  if(!token)return;
  try{
    const r=await fetch('/api/affiliate-admin',{headers:auth()});
    if(r.ok)$('adminLink').style.display='block';
  }catch{}
}
async function load(){
  if(!token){$('loading').hidden=true;$('connect').hidden=false;return}
  try{
    const r=await fetch('/api/affiliate-web',{headers:auth()});
    const data=await r.json();
    if(r.status===401){localStorage.removeItem(deviceKey);$('loading').hidden=true;$('connect').hidden=false;return}
    if(!r.ok||!data.ok)throw new Error(data.message||'Affiliate dashboard gagal dimuat.');
    state=data;$('loading').hidden=true;$('app').hidden=false;render();probeAdmin();
  }catch(e){$('loading').innerHTML='<div class="error">'+(e.message||String(e))+'</div>'}
}

$('payoutMethod').addEventListener('change',togglePayoutFields);
$('savePayout').addEventListener('click',async()=>{
  try{
    $('savePayout').disabled=true;$('payoutStatus').textContent='Saving encrypted payout details…';
    const method=$('payoutMethod').value;
    const payout=method==='DUITNOW'
      ? {method,accountName:$('payoutName').value.trim(),identifierType:$('duitnowType').value,identifier:$('duitnowId').value.trim()}
      : {method,accountName:$('payoutName').value.trim(),bankName:$('bankName').value.trim(),accountNumber:$('bankAccount').value.trim()};
    const r=await fetch('/api/affiliate-web',{method:'POST',headers:auth(),body:JSON.stringify({action:'save_payout',payout})});
    const data=await r.json();if(!r.ok||!data.ok)throw new Error(data.message||'Payout details gagal disimpan.');
    state=data;render();setMsg('Payout details saved securely ✅','ok');
  }catch(e){$('payoutStatus').textContent=e.message||String(e);setMsg(e.message||String(e),'bad')}
  finally{$('savePayout').disabled=false}
});

$('copy').addEventListener('click',async()=>{
  const link=state?.referralLink||'';if(!link)return setMsg('Referral link belum tersedia.','bad');
  try{await navigator.clipboard.writeText(link);setMsg('Referral link copied ✅','ok')}catch{setMsg('Tak dapat copy link. Tekan lama pada link untuk copy.','bad')}
});
$('share').addEventListener('click',async()=>{
  const link=state?.referralLink||'';if(!link)return setMsg('Referral link belum tersedia.','bad');
  try{
    if(navigator.share)await navigator.share({title:'PayPing Affiliate',text:'Guna PayPing melalui link saya 👇',url:link});
    else{await navigator.clipboard.writeText(link);setMsg('Referral link copied ✅','ok')}
  }catch(e){if(e?.name!=='AbortError')setMsg('Share belum berjaya.','bad')}
});
$('withdraw').addEventListener('click',async()=>{
  if(!state?.withdrawAllowed)return;
  const amount=money(state.dashboard.available);
  if(!confirm('Request withdrawal '+amount+'?'))return;
  try{
    $('withdraw').disabled=true;setMsg('Submitting withdrawal…');
    const r=await fetch('/api/affiliate-web',{method:'POST',headers:auth(),body:JSON.stringify({action:'withdraw'})});
    const data=await r.json();if(!r.ok||!data.ok)throw new Error(data.message||'Withdrawal gagal.');
    state=data;
    if(data.withdrawal?.created)setMsg('Withdrawal '+money(data.withdrawal.amount)+' submitted ✅','ok');
    else setMsg('Available belum cukup minimum '+money(data.withdrawal?.minimum)+'.','bad');
    render();
  }catch(e){setMsg(e.message||String(e),'bad');render()}
});
$('commissionTab').addEventListener('click',()=>{tab='commission';$('commissionTab').classList.add('active');$('withdrawTab').classList.remove('active');renderActivity()});
$('withdrawTab').addEventListener('click',()=>{tab='withdrawal';$('withdrawTab').classList.add('active');$('commissionTab').classList.remove('active');renderActivity()});
load();
</script>
</body>
</html>`;

function send(res,type,body){res.statusCode=200;res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');res.end(body)}
export default function affiliatePwaPageHandler(req,res){
  if(req.method!=='GET'&&req.method!=='HEAD')return res.status(405).send('Method Not Allowed');
  return send(res,'text/html; charset=utf-8',req.method==='HEAD'?'':PAGE);
}
