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
.list{display:flex;flex-direction:column;gap:8px}.tx{display:block;text-decoration:none;color:inherit;padding:11px;background:#0c0f16;border-radius:13px;border:1px solid rgba(255,255,255,.055)}.line{display:flex;justify-content:space-between;gap:10px}.name{font-size:13px;font-weight:800}.amount{font-size:14px;font-weight:900}.meta{font-size:10px;color:#858d9c;margin-top:5px}.badge{display:inline-block;padding:3px 6px;border-radius:999px;font-size:9px;font-weight:850;background:#2a2e39}.badge.paid{background:rgba(57,217,138,.13);color:#7ae5af}.badge.checkout_pending,.badge.payment_pending{background:rgba(255,190,60,.13);color:#ffd27c}.badge.payment_review{background:rgba(126,77,255,.18);color:#d7c9ff}
.setupHead{display:flex;justify-content:space-between;align-items:center;gap:10px}.dot{width:9px;height:9px;border-radius:50%;background:#737786;display:inline-block;margin-right:7px}.dot.ok{background:#39d98a;box-shadow:0 0 0 4px rgba(57,217,138,.1)}.setupBody{margin-top:12px}.setupBody[hidden]{display:none}.setupSteps{font-size:12px;color:#aab0bd;line-height:1.55;padding-left:18px}
input.code{width:100%;background:#0c0f16;border:1px solid #292e3b;border-radius:13px;padding:13px;color:#fff;font-size:18px;letter-spacing:4px;text-align:center;margin-top:8px}.btn{width:100%;border:0;border-radius:13px;padding:13px;color:#fff;font-weight:850;margin-top:9px;background:linear-gradient(135deg,#9b6bff,#6d28d9)}.btn.secondary{background:#202532}.btn:disabled{opacity:.45}.msg{font-size:12px;color:#abb2c0;margin-top:9px;min-height:16px}
.loader,.empty{text-align:center;color:#8991a0;padding:24px}.error{padding:15px;border-radius:14px;background:rgba(255,70,70,.08);color:#ffc0c0}
nav{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom));width:min(92%,560px);height:62px;background:rgba(17,19,28,.92);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.08);border-radius:19px;display:grid;grid-template-columns:repeat(4,1fr);padding:6px}nav a{text-decoration:none;color:#858c9c;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:11px;font-weight:800;border-radius:13px;gap:3px}nav a.active{color:#fff;background:rgba(126,77,255,.17)}nav b{font-size:18px}
@media(min-width:620px){.grid{grid-template-columns:repeat(4,1fr)}}

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
  .scope{font-size:12px}.eyebrow{font-size:12px}.muted{font-size:13px;line-height:1.45}
  .stat .k{font-size:12px}.stat .v{font-size:21px}.cardTitle{font-size:16px}
  .quick a{font-size:14px}.name{font-size:14px}.amount{font-size:15px}.meta{font-size:11px}.badge{font-size:10px}
  .setupSteps,.msg{font-size:13px}
}

/* PAYPING_UX_POLISH_V2 */
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a,button,input,select{-webkit-tap-highlight-color:transparent}
a,button,.btn,.quick a,.tab,.back,.link,.item,.tx{touch-action:manipulation}
@media(max-width:619px){
  main{scrollbar-width:none;overscroll-behavior-y:contain;scroll-padding-bottom:calc(104px + env(safe-area-inset-bottom))}
  main::-webkit-scrollbar{display:none}
  .top{margin-bottom:18px}
  .grid{gap:12px}
  button,.btn,.quick a,.back,.tab,.danger,.link,nav a{min-height:44px}
  input,select,textarea{font-size:16px}
  .card,.stat,.hero,.item,.tx,.rowbox,.device,.quick a,.btn,button,.back,.tab,nav a{
    transition:transform .14s ease,opacity .14s ease,border-color .16s ease,background-color .16s ease
  }
  .quick a:active,.btn:active,button:active,.back:active,.tab:active,.item:active,.tx:active{transform:scale(.985)}
  nav a:active{transform:scale(.96)}
  .title,.heroValue,.available,.amount,.v{font-variant-numeric:tabular-nums}
  .cardTitle,.card-title{letter-spacing:-.01em}
  .muted,.meta,.sub,.k{letter-spacing:.005em}
}
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important;animation-duration:.01ms!important;animation-iteration-count:1!important}
}

/* PAYPING_LIGHT_SHELL_V3 */
:root{color-scheme:light}
body{background:#f4f5fb;color:#171725}
.top{padding:18px;border-radius:24px;background:radial-gradient(circle at 86% 0,rgba(133,111,255,.9),transparent 34%),linear-gradient(145deg,#25206f,#4b2eb1 60%,#754aed);box-shadow:0 18px 44px rgba(65,45,157,.2)}
.top .sub{color:rgba(255,255,255,.72)}.top .scope{background:rgba(255,255,255,.15);color:#fff}.top .title{color:#fff}
.hero{background:radial-gradient(circle at 86% 0,rgba(91,189,255,.5),transparent 32%),linear-gradient(145deg,#6943ef,#4775f2 68%,#8051ee);border:0;color:#fff;box-shadow:0 16px 36px rgba(73,70,200,.18)}
.hero .muted{color:rgba(255,255,255,.76)}.hero .eyebrow{color:rgba(255,255,255,.78)}
.stat,.card{background:#fff;border-color:#ececf4;color:#171725;box-shadow:0 8px 24px rgba(50,43,86,.05)}
.stat .k,.muted,.meta,.sub{color:#8e91a4}.quick a{background:#f4f3fb;color:#4f3bc0;border-color:#ebe8f7}.quick a.primary{color:#fff}.tx{background:#fafafe;border-color:#eeeef5}
.name,.amount,.cardTitle,.stat .v{color:#171725}.badge{background:#ececf4;color:#6e7182}
.setupSteps,.msg{color:#7f8396}.btn.secondary{background:#efeff7;color:#504f62}.code{background:#fafafe!important;color:#171725!important;border-color:#e4e4ee!important}
.botHomeList{display:flex;flex-direction:column;gap:9px}.botHome{display:flex;align-items:center;gap:11px;text-decoration:none;color:inherit;padding:12px;border-radius:17px;background:#fafafe;border:1px solid #eeeef5}
.botHomeIcon{width:42px;height:42px;flex:0 0 42px;border-radius:13px;display:grid;place-items:center;background:#11111a;color:#fff;font-size:20px}.botHomeMain{min-width:0;flex:1}.botHomeName{font-size:14px;font-weight:900}.botHomeMeta{font-size:10px;color:#9295a6;margin-top:4px}.botHomeAmount{text-align:right;font-size:14px;font-weight:900;color:#5d40db}.botHomeAmount small{display:block;color:#9a9cad;font-size:9px;margin-top:3px;font-weight:700}
#mainNav{grid-template-columns:repeat(4,1fr);background:rgba(255,255,255,.96);border-color:#e7e7f0;box-shadow:0 12px 36px rgba(45,40,82,.13)}
#mainNav.owner{grid-template-columns:repeat(5,1fr)}#mainNav a{color:#9698a8}#mainNav a.active{color:#fff;background:linear-gradient(145deg,#7152ef,#5837db)}
@media(max-width:619px){
 body{background:#f4f5fb;background-image:none}
 body::before{display:none}
 main{top:env(safe-area-inset-top,0px);left:0;right:0;padding:0 18px calc(102px + env(safe-area-inset-bottom));background:#f4f5fb}
 .top{margin:0 -18px 16px;border-radius:0 0 28px 28px;padding:22px 20px 24px}
 #mainNav{left:12px;right:12px;transform:none;width:auto;bottom:calc(10px + env(safe-area-inset-bottom));height:70px;padding:7px;border:1px solid #e7e7f0;border-radius:23px;background:rgba(255,255,255,.97);box-shadow:0 12px 36px rgba(45,40,82,.13)}
 #mainNav a{font-size:10px}#mainNav b{font-size:20px}
}


/* PAYPING_MOCKUP2_ADMIN_V1 - owner only; preserve affiliate/user experience */
body.ownerDash{--pp-bg:#f3f5fc;--pp-surface:#fff;--pp-ink:#151d37;--pp-muted:#8792ac;--pp-border:#e8ecf7;--pp-soft:#f7f8fd;--pp-shadow:0 9px 28px rgba(38,58,120,.055);background:var(--pp-bg);color:var(--pp-ink);padding:0}
body.ownerDash[data-theme="dark"]{--pp-bg:#0a1223;--pp-surface:#121d31;--pp-ink:#f4f6ff;--pp-muted:#93a1bd;--pp-border:#24314c;--pp-soft:#0d172a;--pp-shadow:0 9px 28px rgba(0,0,0,.15);color-scheme:dark}
body.ownerDash main{max-width:1440px;margin:0 auto;padding:0 26px 48px 220px;min-height:100vh}
body.ownerDash .top{margin:0 0 23px;padding:15px 0;background:none;box-shadow:none;border-radius:0;color:var(--pp-ink)}
body.ownerDash .top .title{color:var(--pp-ink);font-size:20px}
body.ownerDash .top .sub{color:var(--pp-muted)}
body.ownerDash .top .logo{width:37px;height:37px;border-radius:11px}
body.ownerDash .top .scope{color:var(--pp-muted);background:var(--pp-soft)}
body.ownerDash #mainNav{position:fixed;left:max(0px,calc((100vw - 1440px)/2));top:0;bottom:0;transform:none;width:196px;height:auto;display:flex;flex-direction:column;gap:6px;padding:88px 12px 20px;border:0;border-right:1px solid var(--pp-border);border-radius:0;background:var(--pp-surface);box-shadow:none;z-index:5}
body.ownerDash #mainNav a{min-height:48px;display:flex;flex-direction:row;justify-content:flex-start;gap:14px;padding:0 13px;font-size:13px;border-radius:12px;color:var(--pp-muted)}
body.ownerDash #mainNav a b{font-size:22px;font-weight:500}
body.ownerDash #mainNav a.active{background:#e7edff;color:#2452f5}
body.ownerDash[data-theme="dark"] #mainNav a.active{background:#1a3265;color:#8fb4ff}
body.ownerDash #mainNav:before{content:"PayPing";font-size:23px;font-weight:900;color:var(--pp-ink);position:absolute;top:29px;left:22px;letter-spacing:-.7px}
body.ownerDash #dashboard{display:block}
body.ownerDash #dashboard[hidden]{display:none}
body.ownerDash #dashboard .ppHeading{display:flex;align-items:center;justify-content:space-between;gap:15px;margin:6px 0 18px}
body.ownerDash .ppHeading h1{margin:0;font-size:27px;letter-spacing:-.8px}
body.ownerDash .ppHeading p{font-size:13px;color:var(--pp-muted);margin:4px 0 0}
body.ownerDash .ppActions{display:flex;gap:10px;align-items:center}
body.ownerDash .ppButton{display:inline-flex;align-items:center;justify-content:center;gap:7px;text-decoration:none;border-radius:13px;border:1px solid var(--pp-border);background:var(--pp-surface);color:var(--pp-ink);font-size:13px;font-weight:800;padding:12px 17px;cursor:pointer}
body.ownerDash .ppButton.primary{background:linear-gradient(115deg,#2869f8,#a14cf1);color:white;border:0}
body.ownerDash .ppTheme{width:40px;height:40px;border-radius:50%;border:1px solid var(--pp-border);background:var(--pp-surface);color:var(--pp-ink);cursor:pointer;font-size:19px}
body.ownerDash .ppHero{display:grid;grid-template-columns:38% 62%;align-items:center;gap:0;padding:26px;border-radius:18px;background:linear-gradient(110deg,#2769f9,#8b57f3 95%);color:#fff;box-shadow:var(--pp-shadow)}
body.ownerDash .ppHero small{font-size:13px;color:#e8efff}
body.ownerDash .ppHero strong{display:block;font-size:clamp(30px,4vw,42px);letter-spacing:-1.5px;margin:7px 0}
body.ownerDash .ppHero .ppGrowth{display:inline-block;padding:6px 11px;border-radius:100px;background:#d9ffed;color:#069f63;font-weight:800;font-size:12px}
body.ownerDash .ppHero svg{width:100%;height:160px}
body.ownerDash .ppStats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:14px 0}
body.ownerDash .ppStat,body.ownerDash .ppPanel{border-radius:17px;background:var(--pp-surface);border:1px solid var(--pp-border);box-shadow:var(--pp-shadow)}
body.ownerDash .ppStat{padding:18px;min-height:115px}
body.ownerDash .ppStat .ppIco{font-size:22px;color:#3266f7}
body.ownerDash .ppStat .ppK{display:block;color:var(--pp-muted);font-size:12px;margin:10px 0 4px}
body.ownerDash .ppStat strong{font-size:25px}
body.ownerDash .ppCols{display:grid;grid-template-columns:1fr 1fr;gap:14px}
body.ownerDash .ppPanel{padding:18px;margin-bottom:14px}
body.ownerDash .ppPanel h2{font-size:16px;margin:0 0 14px}
body.ownerDash .ppPanel .ppPanelHead{display:flex;justify-content:space-between;align-items:center;gap:8px}
body.ownerDash .ppPanel a{color:#4778fa;text-decoration:none;font-size:12px;font-weight:800}
body.ownerDash .ppBot{display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--pp-border);padding:12px 0;color:inherit;text-decoration:none}
body.ownerDash .ppBot:last-child{border:0}
body.ownerDash .ppBotIcon{width:42px;height:42px;border-radius:13px;background:linear-gradient(135deg,#215cf6,#9143ef);display:grid;place-items:center;color:#fff;font-size:23px;flex:none}
body.ownerDash .ppBotMain{flex:1;min-width:0}
body.ownerDash .ppBotMain strong{font-size:13px}
body.ownerDash .ppBotMain small{display:block;font-size:11px;color:var(--pp-muted);margin-top:5px}
body.ownerDash .ppBotValue{font-size:13px;font-weight:800}
body.ownerDash .ppRecent{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--pp-border);text-decoration:none;color:inherit}
body.ownerDash .ppRecent:last-child{border:0}
body.ownerDash .ppRecent strong{font-size:12px}
body.ownerDash .ppRecent small{display:block;color:var(--pp-muted);font-size:11px;margin-top:4px}
body.ownerDash .ppRecent .ppAmount{color:#0ab478;font-weight:800;font-size:13px}
body.ownerDash #ppMobileAdd{display:none}
body.ownerDash .ppEmpty{color:var(--pp-muted);font-size:13px;padding:14px 0}
body.ownerDash #ppAdminTools{margin-top:14px}
body.ownerDash #ppAdminTools .setupHead{padding:4px}
body.ownerDash #ppAdminTools .cardTitle{color:var(--pp-ink)}
body.ownerDash #ppAdminTools .muted{color:var(--pp-muted)}
body.ownerDash .ppTheme:focus-visible,body.ownerDash .ppButton:focus-visible{outline:3px solid #9e9dff;outline-offset:3px}
@media(max-width:900px){
body.ownerDash main{padding-left:188px;padding-right:16px}
body.ownerDash #mainNav{width:172px}
body.ownerDash .ppStats{grid-template-columns:repeat(2,minmax(0,1fr))}
body.ownerDash .ppCols{grid-template-columns:1fr}
}
@media(max-width:619px){
body.ownerDash{overflow:auto}
body.ownerDash main{position:static;max-width:none;min-height:100vh;padding:0 15px calc(115px + env(safe-area-inset-bottom));overflow:visible;background:var(--pp-bg)}
body.ownerDash .top{padding:17px 0;margin:0 0 10px}
body.ownerDash .top .scope{display:none}
body.ownerDash #mainNav{left:10px;right:10px;top:auto;bottom:calc(9px + env(safe-area-inset-bottom));transform:none;width:auto;height:72px;padding:7px;flex-direction:row;gap:0;border:1px solid var(--pp-border);border-radius:23px;background:var(--pp-surface);box-shadow:var(--pp-shadow)}
body.ownerDash #mainNav:before{display:none}
body.ownerDash #mainNav a{flex:1;min-width:0;padding:0;flex-direction:column;gap:3px;justify-content:center;min-height:0;font-size:10px}
body.ownerDash #mainNav a b{font-size:21px}
body.ownerDash .ppHeading h1{font-size:24px}
body.ownerDash .ppHeading{align-items:flex-start}
body.ownerDash .ppHeading .ppActions .ppButton{display:none}
body.ownerDash .ppHero{display:block;padding:21px}
body.ownerDash .ppHero svg{height:95px}
body.ownerDash .ppStats{gap:10px}
body.ownerDash .ppStat{padding:14px;min-height:108px}
body.ownerDash .ppStat strong{font-size:22px}
body.ownerDash #ppMobileAdd{display:flex;width:100%;margin:4px 0 17px}
}
</style></head>
<body><main>
<div class="top"><div class="brand"><div class="logo"><img src="/ar-payment/payping-icon-v4.svg"></div><div><div class="title">PayPing!</div><div class="sub">Payment dashboard</div></div></div><div id="scope" class="scope">Not connected</div></div>

<div id="dashLoading" class="loader">Loading PayPing…</div>
<section id="onboarding" class="card" hidden><div class="cardTitle">Connect Telegram</div><div class="muted">Link PayPing account dengan Telegram supaya dashboard, payment dan affiliate ikut user yang betul.</div><button id="connectTelegram" class="btn">Connect Telegram</button><div id="linkMsg" class="msg"></div></section>
<div id="dashboard" hidden>
<div id="ppAdminView" hidden>
<div class="ppHeading"><div><h1>Dashboard</h1><p>Overview of your PayPing platform performance.</p></div><div class="ppActions"><button id="ppThemeToggle" class="ppTheme" type="button" aria-label="Toggle light or dark mode">☾</button><a class="ppButton primary" href="/ar-payment/bots/add">＋ Add Bot</a></div></div>
<section class="ppHero"><div><small>Total Revenue</small><strong id="ppRevenue">RM0.00</strong><span class="ppGrowth" id="ppRevenueCount">0 successful payments</span></div><svg viewBox="0 0 520 160" aria-label="Decorative revenue trend"><path d="M0 133 L60 110 L112 118 L166 83 L215 98 L270 62 L321 76 L382 30 L430 54 L520 12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M0 133 L60 110 L112 118 L166 83 L215 98 L270 62 L321 76 L382 30 L430 54 L520 12 L520 160 L0 160 Z" fill="#ffffff" fill-opacity=".13"/></svg></section>
<div class="ppStats"><div class="ppStat"><span class="ppIco">♙</span><span class="ppK">Active Supporters</span><strong id="ppSupporters">—</strong></div><div class="ppStat"><span class="ppIco">◇</span><span class="ppK">Active Bots</span><strong id="ppBotsCount">—</strong></div><div class="ppStat"><span class="ppIco">▣</span><span class="ppK">Pending Payments</span><strong id="ppPending">—</strong></div><div class="ppStat"><span class="ppIco">⚠</span><span class="ppK">All Transactions</span><strong id="ppTransactions">—</strong></div></div>
<div class="ppCols"><section class="ppPanel"><div class="ppPanelHead"><h2>Bot Performance</h2><a href="/ar-payment/bots">View All →</a></div><div id="ppBotRows" class="ppEmpty">Loading bots…</div></section><section class="ppPanel"><div class="ppPanelHead"><h2>Recent Activity</h2><a href="/ar-payment/transactions">View All →</a></div><div id="ppRecentRows" class="ppEmpty">Loading transactions…</div></section></div>
<section class="ppPanel"><div class="ppPanelHead"><h2>Affiliates</h2><a href="/ar-payment/affiliate/admin">View Affiliators →</a></div><p style="font-size:13px;color:var(--pp-muted);margin:0">Manage affiliate accounts, commissions and payouts for each bot.</p></section>
<a id="ppMobileAdd" class="ppButton primary" href="/ar-payment/bots/add">＋ Add Bot</a>
</div>

<section class="hero"><div class="eyebrow">Today received</div><div id="todayReceived" class="heroValue">RM0.00</div><div id="todayCount" class="muted">0 successful payments today</div></section>
<section class="grid">
<div class="stat"><div class="k">Total Received</div><div id="totalReceived" class="v">RM0.00</div></div>
<div class="stat"><div class="k">Paid</div><div id="paidCount" class="v">0</div></div>
<div class="stat"><div class="k">Pending</div><div id="pendingCount" class="v">0</div></div>
<div class="stat"><div class="k">All Transactions</div><div id="totalCount" class="v">0</div></div>
</section>
<section id="botsSection" class="card" hidden><div class="line"><div class="cardTitle">Your Bots</div><a href="/ar-payment/bots" style="font-size:11px;color:#6748df;text-decoration:none;font-weight:800">View all ›</a></div><div id="botHomeList" class="botHomeList"></div></section>
<section class="card"><div class="cardTitle">Quick Actions</div><div class="quick"><a class="primary" href="/ar-payment/transactions">Transactions</a><a id="earnQuick" href="/ar-payment/affiliate">Affiliate / Earn</a><a href="/ar-payment/notifications">Notifications</a><a href="/ar-payment/settings">Settings / Account</a><a id="analyticsQuick" href="/ar-payment/analytics" hidden>Analytics / Reports</a><a id="affiliateAdminQuick" href="/ar-payment/affiliate/admin" hidden>Affiliate Admin</a></div></section>
<section class="card"><div class="line"><div class="cardTitle">Recent Payments</div><a href="/ar-payment/transactions" style="font-size:11px;color:#bfaeff;text-decoration:none">View all</a></div><div id="recent" class="list"></div></section>
</div>

<section id="ppAdminTools" class="card">
<div class="setupHead"><div><div class="cardTitle" style="margin:0"><span id="dot" class="dot"></span>Notifications</div><div id="state" class="muted">Belum connected</div></div><button id="toggleSetup" class="btn secondary" style="width:auto;margin:0;padding:9px 11px">Setup</button></div>
<div id="setupBody" class="setupBody" hidden>
<div id="modernPushHint" class="muted" style="margin-bottom:12px"></div>
<div id="legacyPushSetup">
<ol class="setupSteps"><li>Dalam private chat bot, taip <b>/pushsetup</b>.</li><li>Masukkan setup code 8 digit.</li><li>Tekan Enable Notifications.</li></ol>
<input id="code" class="code" inputmode="numeric" maxlength="8" placeholder="00000000" autocomplete="one-time-code">
</div>
<button id="enable" class="btn">Enable Notifications</button><button id="test" class="btn secondary" disabled>Send Test Notification</button><div id="msg" class="msg"></div>
</div>
</section>
</main>
<nav id="mainNav"><a class="active" href="/ar-payment/"><b>⌂</b>Home</a><a id="botsNav" href="/ar-payment/bots" hidden><b>◇</b>Bots</a><a href="/ar-payment/transactions"><b>≡</b>Transactions</a><a id="affiliateNav" href="/ar-payment/affiliate"><b>♙</b>Affiliates</a><a href="/ar-payment/settings"><b>⚙</b>Settings</a></nav>
<script>
const $=id=>document.getElementById(id);const deviceKey='ar_payment_device_token_v1';const telegramLinkKey='payping_telegram_link_pending_v1';const token=()=>localStorage.getItem(deviceKey)||'';let accountContext=null;let telegramLinkWatch=null;let telegramLinkCheckBusy=false;
const authHeaders=(json=false)=>{const h=json?{'Content-Type':'application/json'}:{};const t=token();if(t)h['X-PayPing-Device-Token']=t;return h};
const money=v=>'RM'+(Number(v||0)||0).toFixed(2);const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const date=v=>{if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?'-':new Intl.DateTimeFormat('en-MY',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(d)};
function refreshConnection(){const t=token();$('test').disabled=!t;$('dot').classList.toggle('ok',!!t);$('state').textContent=t?'Push connected ✅':'Belum connected'}
async function loadIdentity(){
 try{
  const r=await fetch('/api/payping-auth',{headers:authHeaders(false)});const d=await r.json();
  if(r.status===401){
    if(token())return {legacy:true,role:'legacy',needsTelegramLink:false};
    location.replace('/ar-payment/login');return null;
  }
  if(!r.ok||!d.ok)throw new Error(d.message||'Account unavailable.');
  accountContext=d;updateNotificationSetupUI();
  const role=String(d.role||'user').toLowerCase();
  $('scope').textContent=role==='owner'||role==='admin'?'Merchant view':role==='affiliate'?'Affiliate view':'User view';
  $('earnQuick').textContent=role==='user'?'Join Affiliate / Earn':'Affiliate / Earn';
  const owner=Boolean(d.owner)||role==='owner'||role==='admin';
  $('botsNav').hidden=!owner;
  $('mainNav').classList.toggle('owner',owner);
  $('affiliateNav').href=owner?'/ar-payment/affiliate/admin':'/ar-payment/affiliate';
  return d;
 }catch(e){
  $('dashLoading').innerHTML='<div class="error">'+esc(e.message||String(e))+'</div>';return null;
 }
}
async function refreshTelegramLinkState(){
 if(telegramLinkCheckBusy)return false;
 telegramLinkCheckBusy=true;
 try{
  const r=await fetch('/api/payping-auth',{headers:authHeaders(false),cache:'no-store'});const d=await r.json();
  if(!r.ok||!d.ok)return false;
  if(!d.needsTelegramLink&&d.account?.telegramUserId){
   sessionStorage.removeItem(telegramLinkKey);
   if(telegramLinkWatch){clearInterval(telegramLinkWatch);telegramLinkWatch=null}
   $('linkMsg').textContent='Telegram linked ✅';
   $('onboarding').hidden=true;$('dashLoading').hidden=false;$('dashLoading').textContent='Loading PayPing…';
   await loadDashboard();
   return true;
  }
  return false;
 }catch{return false}
 finally{telegramLinkCheckBusy=false}
}
function startTelegramLinkWatch(){
 sessionStorage.setItem(telegramLinkKey,'1');
 if(telegramLinkWatch)clearInterval(telegramLinkWatch);
 telegramLinkWatch=setInterval(()=>{if(!document.hidden)refreshTelegramLinkState()},1500);
 setTimeout(()=>{if(telegramLinkWatch){clearInterval(telegramLinkWatch);telegramLinkWatch=null}},90000);
}
async function requestTelegramLink(){
 try{
  $('connectTelegram').disabled=true;$('linkMsg').textContent='Preparing Telegram link…';
  const r=await fetch('/api/payping-auth',{method:'POST',headers:authHeaders(true),body:JSON.stringify({action:'request_telegram_link'})});
  const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.message||'Tak berjaya generate Telegram link.');
  if(d.alreadyLinked){sessionStorage.removeItem(telegramLinkKey);await refreshTelegramLinkState();return}
  if(!d.telegramLink)throw new Error('Telegram bot link belum tersedia.');
  $('linkMsg').textContent='Opening Telegram…';startTelegramLinkWatch();location.href=d.telegramLink;
 }catch(e){$('linkMsg').textContent=e.message||String(e)}finally{$('connectTelegram').disabled=false}
}

async function loadBotCards(){
 try{
  const r=await fetch('/api/payping-data?view=bots',{headers:authHeaders(false),cache:'no-store'});const d=await r.json();
  if(!r.ok||!d.ok)return;
  const bots=d.bots||[];
  $('botHomeList').innerHTML=bots.length?bots.map(b=>'<a class="botHome" href="/ar-payment/bot?bot='+encodeURIComponent(b.id)+'"><div class="botHomeIcon">'+(b.id==='musix'?'♫':'⇩')+'</div><div class="botHomeMain"><div class="botHomeName">'+esc(b.name)+'</div><div class="botHomeMeta">'+esc(b.supporterCount||0)+' supporters · '+esc(b.activeAffiliates||0)+' affiliators</div></div><div class="botHomeAmount">'+money(b.totalReceived)+'<small>'+esc(b.successfulPayments||0)+' paid</small></div></a>').join(''):'<div class="empty">Belum ada bot.</div>';
  $('botsSection').hidden=false;
 }catch{}
}

async function loadDashboard(){
 const identity=await loadIdentity();if(!identity)return;
 if(identity.needsTelegramLink){
  $('dashLoading').hidden=true;$('dashboard').hidden=true;$('onboarding').hidden=false;return;
 }
 try{const r=await fetch('/api/payping-data?view=dashboard',{headers:authHeaders(false)});const d=await r.json();
 if(r.status===401){location.replace('/ar-payment/login');return}
 if(r.status===409&&d.error==='PAYPING_TELEGRAM_LINK_REQUIRED'){$('dashLoading').hidden=true;$('onboarding').hidden=false;return}
 if(!r.ok||!d.ok)throw new Error(d.message||'Dashboard unavailable.');
 const s=d.summary;$('scope').textContent=d.owner?'Merchant view':String(d.role||'user').toLowerCase()==='affiliate'?'Affiliate view':'My view';$('analyticsQuick').hidden=!d.owner;$('affiliateAdminQuick').hidden=!d.owner;$('todayReceived').textContent=money(s.todayReceived);$('todayCount').textContent=s.todayTransactions+' successful payments today';$('totalReceived').textContent=money(s.totalReceived);$('paidCount').textContent=s.paidTransactions;$('pendingCount').textContent=s.pendingTransactions;$('totalCount').textContent=s.totalTransactions;
 $('recent').innerHTML=d.recent.length?d.recent.map(t=>'<a class="tx" href="/ar-payment/transaction?order='+encodeURIComponent(t.orderNumber)+'"><div class="line"><div><div class="name">'+esc(t.displayName||t.username||('ID '+t.userId))+'</div><div class="meta">'+esc(t.tierLabel)+' · '+date(t.paidAt||t.createdAt)+' · Details →</div></div><div style="text-align:right"><div class="amount">'+money(t.amount)+'</div><span class="badge '+esc(t.status.toLowerCase())+'">'+esc(t.status)+'</span></div></div></a>').join(''):'<div class="empty">No payments yet.</div>';
 if(d.owner){ppAdminStart(d);await loadBotCards();}
 $('dashLoading').hidden=true;$('onboarding').hidden=true;$('dashboard').hidden=false;
 }catch(e){$('dashLoading').hidden=false;$('dashLoading').innerHTML='<div class="error">'+esc(e.message||String(e))+'</div>'}
}
$('connectTelegram').addEventListener('click',requestTelegramLink);
$('toggleSetup').addEventListener('click',()=>{$('setupBody').hidden=!$('setupBody').hidden});
const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);const isAndroid=/android/i.test(navigator.userAgent);
function updateNotificationSetupUI(){
 const linked=Boolean(accountContext?.account?.telegramUserId);
 $('legacyPushSetup').hidden=linked;
 if(linked){
  $('modernPushHint').textContent=isIOS
   ? 'iPhone/iPad: Add PayPing! ke Home Screen dahulu, kemudian tekan Enable Notifications.'
   : isAndroid
    ? 'Android: tekan Enable Notifications dan benarkan notification bila browser minta permission.'
    : 'Tekan Enable Notifications dan benarkan notification bila browser minta permission.';
 }else{
  $('modernPushHint').textContent='Fallback setup: guna /pushsetup dan code 8 digit.';
 }
}
const b64ToBytes=s=>{const p='='.repeat((4-s.length%4)%4);const b=(s+p).replace(/-/g,'+').replace(/_/g,'/');const raw=atob(b);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))};
function setMsg(t,bad=false){$('msg').textContent=t;$('msg').style.color=bad?'#ff9a9a':'#abb2c0'}
if('serviceWorker' in navigator)navigator.serviceWorker.getRegistration('/ar-payment/').then(r=>r?.update()).catch(()=>{});
$('enable').addEventListener('click',async()=>{try{
 if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))throw new Error('Browser/device ini belum support Web Push notification.');
 if(isIOS&&!isStandalone())throw new Error('iPhone/iPad: Add PayPing! ke Home Screen dulu, kemudian buka dari Home Screen.');
 const linked=Boolean(accountContext?.account?.telegramUserId);
 const code=$('code').value.trim();
 if(!linked&&!/^\\d{8}$/.test(code))throw new Error('Masukkan setup code 8 digit daripada /pushsetup.');
 $('enable').disabled=true;setMsg('Preparing notifications…');
 const config=await fetch('/api/payment-push').then(r=>r.json());if(!config.ok||!config.configured||!config.publicKey)throw new Error('Web Push server belum ready.');
 const reg=await navigator.serviceWorker.register('/ar-payment/sw.js',{scope:'/ar-payment/'});const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Notification permission tidak dibenarkan.');
 let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToBytes(config.publicKey)});
 const payload={action:'subscribe',subscription:sub.toJSON()};if(!linked)payload.code=code;
 const response=await fetch('/api/payment-push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await response.json();if(!response.ok||!d.ok)throw new Error(d.message||'Tak berjaya register device.');
 localStorage.setItem(deviceKey,d.deviceToken);$('code').value='';refreshConnection();setMsg('Notifications connected ✅');$('dashLoading').hidden=false;$('dashboard').hidden=true;loadDashboard();
 }catch(e){setMsg(e.message||String(e),true)}finally{$('enable').disabled=false}});
$('test').addEventListener('click',async()=>{try{const t=token();if(!t)throw new Error('Device belum connected.');$('test').disabled=true;const r=await fetch('/api/payment-push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'test',deviceToken:t})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.message||'Test push gagal.');setMsg('Test push sent ✅')}catch(e){setMsg(e.message||String(e),true)}finally{refreshConnection()}});
window.addEventListener('pageshow',()=>{if(sessionStorage.getItem(telegramLinkKey)==='1')refreshTelegramLinkState()});
window.addEventListener('focus',()=>{if(sessionStorage.getItem(telegramLinkKey)==='1')refreshTelegramLinkState()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&sessionStorage.getItem(telegramLinkKey)==='1')refreshTelegramLinkState()});

function ppApplyTheme(theme){
 const selected=theme==='dark'?'dark':'light';
 document.body.dataset.theme=selected;
 const b=$('ppThemeToggle');
 if(b){b.textContent=selected==='dark'?'☀':'☾';b.setAttribute('aria-label',selected==='dark'?'Switch to light mode':'Switch to dark mode')}
 try{localStorage.setItem('payping_admin_theme_v1',selected)}catch{}
}
function ppAdminStart(data){
 if(!data.owner)return;
 document.body.classList.add('ownerDash');
 $('ppAdminView').hidden=false;
 const existing=$('dashboard').querySelectorAll(':scope > section, :scope > div:not(#ppAdminView)');
 existing.forEach(e=>e.hidden=true);
 $('ppAdminTools').hidden=false;
 $('ppRevenue').textContent=money(data.summary.totalReceived);
 $('ppRevenueCount').textContent=String(data.summary.paidTransactions||0)+' successful payments';
 $('ppPending').textContent=String(data.summary.pendingTransactions||0);
 $('ppTransactions').textContent=String(data.summary.totalTransactions||0);
 const recent=Array.isArray(data.recent)?data.recent:[];
 $('ppRecentRows').innerHTML=recent.length?recent.slice(0,5).map(t=>'<a class="ppRecent" href="/ar-payment/transaction?order='+encodeURIComponent(t.orderNumber)+'"><span><strong>'+esc(t.displayName||t.username||('ID '+t.userId))+'</strong><small>'+esc(t.tierLabel||'Payment')+' · '+date(t.paidAt||t.createdAt)+'</small></span><span class="ppAmount">'+money(t.amount)+'</span></a>').join(''):'<div class="ppEmpty">No payments yet.</div>';
 let selected='light';try{selected=localStorage.getItem('payping_admin_theme_v1')||'light'}catch{}
 ppApplyTheme(selected);
 $('ppThemeToggle').onclick=()=>ppApplyTheme(document.body.dataset.theme==='dark'?'light':'dark');
 ppLoadBots();
}
async function ppLoadBots(){
 try{
 const r=await fetch('/api/payping-data?view=bots',{headers:authHeaders(false),cache:'no-store'});
 const d=await r.json();if(!r.ok||!d.ok)throw new Error('Bots unavailable');
 const bots=Array.isArray(d.bots)?d.bots:[];
 $('ppBotsCount').textContent=String(bots.filter(b=>b.status==='active').length);
 $('ppSupporters').textContent=String(bots.reduce((n,b)=>n+Number(b.supporterCount||b.activeSupporters||0),0));
 $('ppBotRows').innerHTML=bots.length?bots.map(b=>'<a class="ppBot" href="/ar-payment/bot?bot='+encodeURIComponent(b.id)+'"><span class="ppBotIcon">'+(b.id==='musix'?'♫':'▸')+'</span><span class="ppBotMain"><strong>'+esc(b.name)+'</strong><small>'+esc(b.supporterCount||b.activeSupporters||0)+' supporters · '+esc(b.activeAffiliates||0)+' affiliators</small></span><span class="ppBotValue">'+money(b.totalReceived)+'</span></a>').join(''):'<div class="ppEmpty">No bots yet.</div>';
 }catch(e){$('ppBotRows').textContent='Bot data unavailable';$('ppBotsCount').textContent='—';$('ppSupporters').textContent='—'}
}

refreshConnection();loadDashboard();
</script></body></html>`;

function send(res,type,body){res.statusCode=200;res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');res.end(body)}
export default function payPingHomePage(req,res){
 if(req.method!=='GET'&&req.method!=='HEAD')return res.status(405).send('Method Not Allowed');
 return send(res,'text/html; charset=utf-8',req.method==='HEAD'?'':PAGE);
}
