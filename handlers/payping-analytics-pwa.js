const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#6d28d9"><title>PayPing! Analytics</title>
<link rel="manifest" href="/ar-payment/payping-v4.webmanifest"><link rel="icon" href="/ar-payment/payping-icon-v4.svg">
<style>
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 0,#27104f 0,#11111b 38%,#07070d 100%);color:#f8f8fb;padding:env(safe-area-inset-top) 15px calc(15px + env(safe-area-inset-right)) calc(92px + env(safe-area-inset-bottom)) calc(15px + env(safe-area-inset-left))}
main{max-width:760px;margin:auto;padding:22px 0}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}.brand{display:flex;gap:10px;align-items:center}.logo{width:42px;height:42px;border-radius:13px;overflow:hidden}.logo img{width:100%;height:100%}.title{font-size:21px;font-weight:900}.sub{font-size:11px;color:#9299aa}.back{padding:9px 11px;border-radius:12px;background:#1d2130;color:#ddd4ff;text-decoration:none;font-size:13px;font-weight:800}
.toolbar{display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:12px}.select,button{border:0;border-radius:13px;padding:12px 14px;font-weight:850;color:#fff}.select{background:#151924;border:1px solid #2b3140;outline:none}.export{background:linear-gradient(135deg,#9b6bff,#6d28d9)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:12px}.stat,.card{background:rgba(18,21,30,.9);border:1px solid rgba(255,255,255,.07);border-radius:18px;padding:14px}.stat .k{font-size:10px;color:#8d95a5}.stat .v{font-size:19px;font-weight:900;margin-top:6px}.card{margin-bottom:12px}.cardTitle{font-size:15px;font-weight:900;margin-bottom:11px}.muted{font-size:10px;color:#858d9c}
.chart{display:flex;align-items:flex-end;gap:6px;height:170px;overflow-x:auto;padding:8px 3px 3px}.barwrap{flex:0 0 28px;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px}.bar{width:100%;min-height:3px;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,#9b6bff,#6d28d9)}.barLabel{font-size:8px;color:#7e8798;white-space:nowrap}.barValue{font-size:8px;color:#cfc7f8;writing-mode:vertical-rl;transform:rotate(180deg);max-height:46px;overflow:hidden}
.monthly .barwrap{flex-basis:34px}.monthly .bar{background:linear-gradient(180deg,#54dfa0,#23845b)}
.rows{display:flex;flex-direction:column;gap:8px}.rowbox{padding:11px;background:#0b0e15;border:1px solid rgba(255,255,255,.055);border-radius:13px}.line{display:flex;justify-content:space-between;gap:12px;align-items:center}.name{font-size:12px;font-weight:850}.amount{font-size:13px;font-weight:900}.meter{height:6px;background:#1d2230;border-radius:999px;overflow:hidden;margin-top:7px}.fill{height:100%;background:linear-gradient(90deg,#8b5cf6,#6d28d9);border-radius:999px}.rank{width:24px;height:24px;display:grid;place-items:center;border-radius:8px;background:#202533;color:#c9d0de;font-size:10px;font-weight:900}
.loader,.empty{text-align:center;color:#8991a0;padding:28px}.error{padding:15px;border-radius:14px;background:rgba(255,70,70,.08);color:#ffc0c0}.note{font-size:10px;color:#7f8797;line-height:1.5;margin-top:8px}
nav{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom));width:min(94%,620px);height:62px;background:rgba(17,19,28,.92);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.08);border-radius:19px;display:grid;grid-template-columns:repeat(4,1fr);padding:6px}nav a{text-decoration:none;color:#858c9c;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:10px;font-weight:800;border-radius:13px;gap:3px}nav b{font-size:17px}
@media(min-width:620px){.grid{grid-template-columns:repeat(4,1fr)}}
</style></head>
<body><main>
<div class="top"><div class="brand"><div class="logo"><img src="/ar-payment/payping-icon-v4.svg"></div><div><div class="title">Analytics / Reports</div><div id="periodLabel" class="sub">Merchant analytics</div></div></div><a class="back" href="/ar-payment/">Home</a></div>
<div class="toolbar"><select id="range" class="select"><option value="7d">Last 7 days</option><option value="30d" selected>Last 30 days</option><option value="90d">Last 90 days</option></select><button id="export" class="export">Export CSV</button></div>
<div id="loading" class="loader">Loading analytics…</div>
<div id="app" hidden>
<section class="grid">
<div class="stat"><div class="k">Received</div><div id="received" class="v">RM0.00</div></div>
<div class="stat"><div class="k">Net After Affiliate</div><div id="net" class="v">RM0.00</div></div>
<div class="stat"><div class="k">Payments</div><div id="payments" class="v">0</div></div>
<div class="stat"><div class="k">Unique Supporters</div><div id="unique" class="v">0</div></div>
<div class="stat"><div class="k">Average Payment</div><div id="average" class="v">RM0.00</div></div>
<div class="stat"><div class="k">Affiliate Cost</div><div id="affiliateCost" class="v">RM0.00</div></div>
<div class="stat"><div class="k">Affiliate Paid</div><div id="affiliatePaid" class="v">RM0.00</div></div>
<div class="stat"><div class="k">Commissions</div><div id="commissionCount" class="v">0</div></div>
</section>
<section class="card"><div class="cardTitle">Daily Revenue</div><div id="dailyChart" class="chart"></div><div class="note">Malaysia time (UTC+8). Scroll chart horizontally for longer ranges.</div></section>
<section class="card"><div class="cardTitle">Monthly Revenue · Last 12 Months</div><div id="monthlyChart" class="chart monthly"></div></section>
<section class="card"><div class="cardTitle">Support Tier Breakdown</div><div id="tiers" class="rows"></div></section>
<section class="card"><div class="cardTitle">Top Supporters</div><div id="supporters" class="rows"></div></section>
</div>
</main>
<nav><a href="/ar-payment/"><b>⌂</b>Home</a><a href="/ar-payment/transactions"><b>≡</b>Transactions</a><a href="/ar-payment/affiliate"><b>₿</b>Earn</a><a href="/ar-payment/settings"><b>⚙</b>Settings</a></nav>
<script>
const key='ar_payment_device_token_v1';const token=localStorage.getItem(key)||'';const $=id=>document.getElementById(id);
const headers=()=>({Authorization:'Bearer '+token});const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>'RM'+(Number(v||0)||0).toFixed(2);
function chart(el,rows,key,labelKey){
 if(!rows.length){el.innerHTML='<div class="empty">No paid transactions in this period.</div>';return}
 const max=Math.max(...rows.map(x=>Number(x.amount||0)),1);
 el.innerHTML=rows.map(x=>{const val=Number(x.amount||0);const h=Math.max(3,Math.round((val/max)*120));return '<div class="barwrap" title="'+esc(labelKey(x))+' · '+money(val)+' · '+x.payments+' payment(s)"><div class="barValue">'+money(val)+'</div><div class="bar" style="height:'+h+'px"></div><div class="barLabel">'+esc(key(x))+'</div></div>'}).join('');
}
function render(d){
 const s=d.summary;$('periodLabel').textContent=d.range.label+' · Merchant analytics';$('received').textContent=money(s.received);$('net').textContent=money(s.netAfterAffiliate);$('payments').textContent=s.payments;$('unique').textContent=s.uniqueSupporters;$('average').textContent=money(s.averagePayment);$('affiliateCost').textContent=money(s.affiliateCost);$('affiliatePaid').textContent=money(s.affiliatePaid);$('commissionCount').textContent=s.affiliateCommissions;
 chart($('dailyChart'),d.daily,x=>x.date.slice(5),x=>x.date);
 chart($('monthlyChart'),d.monthly,x=>x.month.slice(2),x=>x.month);
 const maxTier=Math.max(...d.tiers.map(x=>Number(x.amount||0)),1);$('tiers').innerHTML=d.tiers.length?d.tiers.map(x=>'<div class="rowbox"><div class="line"><div><div class="name">'+esc(x.tier)+'</div><div class="muted">'+x.payments+' payment(s)</div></div><div class="amount">'+money(x.amount)+'</div></div><div class="meter"><div class="fill" style="width:'+Math.max(2,(Number(x.amount||0)/maxTier)*100)+'%"></div></div></div>').join(''):'<div class="empty">No tier data.</div>';
 $('supporters').innerHTML=d.topSupporters.length?d.topSupporters.map((x,i)=>'<div class="rowbox"><div class="line"><div style="display:flex;align-items:center;gap:9px"><div class="rank">'+(i+1)+'</div><div><div class="name">'+esc(x.displayName||x.username||('ID '+x.userId))+'</div><div class="muted">'+x.payments+' payment(s) · ID '+esc(x.userId)+'</div></div></div><div class="amount">'+money(x.amount)+'</div></div></div>').join(''):'<div class="empty">No supporter data.</div>';
}
async function load(){
 if(!token){$('loading').innerHTML='<div class="error">Device belum connected.</div>';return}
 try{const p=new URLSearchParams({view:'analytics',range:$('range').value});const r=await fetch('/api/payping-data?'+p,{headers:headers()});const d=await r.json();if(r.status===403)throw new Error('Analytics hanya untuk merchant owner.');if(!r.ok||!d.ok)throw new Error(d.message||'Analytics unavailable.');render(d);$('loading').hidden=true;$('app').hidden=false}catch(e){$('app').hidden=true;$('loading').hidden=false;$('loading').innerHTML='<div class="error">'+esc(e.message||String(e))+'</div>'}
}
function csvCell(v){let s=String(v??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}
$('export').addEventListener('click',async()=>{try{$('export').disabled=true;$('export').textContent='Preparing…';const p=new URLSearchParams({view:'analytics-export',range:$('range').value,limit:'5000'});const r=await fetch('/api/payping-data?'+p,{headers:headers()});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.message||'Export failed.');const cols=['Order ID','Transaction ID','Telegram User ID','Username','Display Name','Tier','Amount RM','Status','Paid At','Affiliate Commission RM','Affiliate Status'];const lines=[cols.map(csvCell).join(',')];for(const x of d.rows)lines.push([x.orderNumber,x.transactionId,x.userId,x.username,x.displayName,x.tier,x.amount,x.status,x.paidAt,x.affiliateCommission,x.affiliateStatus].map(csvCell).join(','));const blob=new Blob(['\\uFEFF'+lines.join('\\r\\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='payping-report-'+d.range.key+'-'+new Date().toISOString().slice(0,10)+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){alert(e.message||String(e))}finally{$('export').disabled=false;$('export').textContent='Export CSV'}});
$('range').addEventListener('change',load);load();
</script></body></html>`;

function send(res,type,body){res.statusCode=200;res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');res.end(body)}
export default function payPingAnalyticsPage(req,res){
 if(req.method!=='GET'&&req.method!=='HEAD')return res.status(405).send('Method Not Allowed');
 return send(res,'text/html; charset=utf-8',req.method==='HEAD'?'':PAGE);
}
