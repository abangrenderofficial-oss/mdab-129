const PAGE = String.raw\`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#35239a"><meta name="apple-mobile-web-app-capable" content="yes">
<title>PayPing! Bots</title><link rel="manifest" href="/ar-payment/payping-v4.webmanifest"><link rel="icon" href="/ar-payment/payping-icon-v4.svg">
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif;color:#171725;background:#f4f5fb}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f4f5fb;color:#171725}
main{max-width:680px;margin:0 auto;padding:0 16px calc(96px + env(safe-area-inset-bottom))}
.header{margin:0 -16px 18px;padding:calc(22px + env(safe-area-inset-top)) 20px 24px;background:radial-gradient(circle at 85% 0,rgba(140,108,255,.9),transparent 34%),linear-gradient(145deg,#24206f,#4b2db4 56%,#6f46ef);color:#fff;border-radius:0 0 28px 28px;box-shadow:0 18px 46px rgba(56,35,142,.22)}
.top{display:flex;align-items:center;justify-content:space-between;gap:14px}.brand{display:flex;align-items:center;gap:11px}.logo{width:46px;height:46px;border-radius:15px;background:rgba(255,255,255,.12);overflow:hidden}.logo img{width:100%;height:100%;display:block}.title{font-size:26px;font-weight:900;letter-spacing:-.6px}.sub{font-size:12px;color:rgba(255,255,255,.72);margin-top:3px}.count{padding:8px 11px;border-radius:999px;background:rgba(255,255,255,.14);font-size:12px;font-weight:800}
.sectionTitle{font-size:20px;font-weight:900;margin:22px 2px 12px;letter-spacing:-.35px}.muted{font-size:12px;color:#8a8da0}
.list{display:flex;flex-direction:column;gap:12px}.bot{display:block;text-decoration:none;color:inherit;background:#fff;border:1px solid #ececf4;border-radius:22px;padding:16px;box-shadow:0 10px 28px rgba(51,45,99,.07)}
.botTop{display:flex;align-items:center;gap:12px}.icon{width:52px;height:52px;border-radius:16px;display:grid;place-items:center;background:linear-gradient(145deg,#141221,#05050a);color:#fff;font-size:24px;box-shadow:0 8px 18px rgba(0,0,0,.16)}.botMain{min-width:0;flex:1}.name{font-size:16px;font-weight:900}.status{font-size:11px;color:#19a66c;margin-top:4px;font-weight:800}.chev{font-size:27px;color:#7256e8}
.metrics{display:grid;grid-template-columns:1.2fr repeat(3,1fr);gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid #eeeef5}.metric .k{font-size:10px;color:#9698a8}.metric .v{font-size:14px;font-weight:900;margin-top:4px}.metric:first-child .v{color:#5c3de1}
.empty,.loader,.error{padding:28px 18px;text-align:center;border-radius:18px;background:#fff;border:1px solid #ececf4;color:#878a9d}.error{color:#a63845;background:#fff6f7;border-color:#ffd9de}
nav{position:fixed;z-index:20;left:50%;transform:translateX(-50%);bottom:calc(10px + env(safe-area-inset-bottom));width:min(94%,620px);height:70px;background:rgba(255,255,255,.96);backdrop-filter:blur(18px);border:1px solid #e9e9f2;border-radius:23px;display:grid;grid-template-columns:repeat(5,1fr);padding:7px;box-shadow:0 14px 38px rgba(42,39,78,.14)}
nav a{text-decoration:none;color:#9496a7;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:10px;font-weight:800;border-radius:16px}nav a b{font-size:19px}nav a.active{color:#fff;background:linear-gradient(145deg,#7152ef,#5837db)}
@media(max-width:430px){.metrics{grid-template-columns:1.2fr 1fr 1fr}.metrics .metric:last-child{grid-column:2/4}.title{font-size:24px}}
</style></head>
<body><main>
<section class="header"><div class="top"><div class="brand"><div class="logo"><img src="/ar-payment/payping-icon-v4.svg" alt=""></div><div><div class="title">Bots</div><div class="sub">Manage PayPing products & payment flows</div></div></div><div id="count" class="count">0 bots</div></div></section>
<div class="sectionTitle">Your Bots</div><div class="muted" style="margin:0 2px 12px">Each bot keeps its own plan, payment portal, supporters and affiliate view.</div>
<div id="loading" class="loader">Loading bots…</div><div id="error" class="error" hidden></div><div id="list" class="list" hidden></div>
</main>
<nav><a href="/ar-payment/"><b>⌂</b>Home</a><a class="active" href="/ar-payment/bots"><b>◇</b>Bots</a><a href="/ar-payment/transactions"><b>≡</b>Transactions</a><a href="/ar-payment/affiliate/admin"><b>♙</b>Affiliates</a><a href="/ar-payment/settings"><b>⚙</b>Settings</a></nav>
<script>
const key='ar_payment_device_token_v1';const token=localStorage.getItem(key)||'';const $=id=>document.getElementById(id);
const headers=()=>token?{'X-PayPing-Device-Token':token}:{};
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>'RM '+(Number(v||0)||0).toFixed(2);
function icon(bot){return bot.id==='musix'?'♫':'⇩'}
function card(bot){return '<a class="bot" href="/ar-payment/bot?bot='+encodeURIComponent(bot.id)+'"><div class="botTop"><div class="icon">'+icon(bot)+'</div><div class="botMain"><div class="name">'+esc(bot.name)+'</div><div class="status">● '+esc(bot.status||'active')+'</div></div><div class="chev">›</div></div><div class="metrics"><div class="metric"><div class="k">Received</div><div class="v">'+money(bot.totalReceived)+'</div></div><div class="metric"><div class="k">Paid</div><div class="v">'+esc(bot.successfulPayments||0)+'</div></div><div class="metric"><div class="k">Supporters</div><div class="v">'+esc(bot.supporterCount||0)+'</div></div><div class="metric"><div class="k">Affiliators</div><div class="v">'+esc(bot.activeAffiliates||0)+'</div></div></div></a>'}
async function load(){try{const r=await fetch('/api/payping-data?view=bots',{headers:headers(),cache:'no-store'});const d=await r.json();if(r.status===401){location.replace('/ar-payment/login');return}if(r.status===403)throw new Error('Owner access sahaja.');if(!r.ok||!d.ok)throw new Error(d.message||'Bots unavailable.');const bots=d.bots||[];$('count').textContent=bots.length+' bots';$('list').innerHTML=bots.length?bots.map(card).join(''):'<div class="empty">Belum ada bot.</div>';$('loading').hidden=true;$('list').hidden=false}catch(e){$('loading').hidden=true;$('error').hidden=false;$('error').textContent=e.message||String(e)}}
load();
</script></body></html>\`;
function send(res,type,body){res.statusCode=200;res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');res.end(body)}
export default function payPingBotsPage(req,res){if(req.method!=='GET'&&req.method!=='HEAD')return res.status(405).send('Method Not Allowed');return send(res,'text/html; charset=utf-8',req.method==='HEAD'?'':PAGE);}
