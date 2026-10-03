const PAGE = String.raw`<!doctype html>
<html lang="ms">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#6d28d9"><title>PayPing! Register</title>
<link rel="manifest" href="/ar-payment/payping-v4.webmanifest"><link rel="icon" href="/ar-payment/payping-icon-v4.svg">
<style>
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Segoe UI",sans-serif}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 0,#27104f 0,#11111b 38%,#07070d 100%);color:#f8f8fb;-webkit-font-smoothing:antialiased}
main{width:min(100%,520px);margin:0 auto;padding:calc(env(safe-area-inset-top) + 42px) calc(20px + env(safe-area-inset-right)) calc(40px + env(safe-area-inset-bottom)) calc(20px + env(safe-area-inset-left))}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:30px}.logo{width:54px;height:54px;border-radius:16px;overflow:hidden;flex:0 0 54px}.logo img{width:100%;height:100%;display:block}.title{font-size:28px;font-weight:900;letter-spacing:-.03em}.sub{font-size:13px;color:#969dad;margin-top:3px}
.card{background:rgba(18,21,30,.90);border:1px solid rgba(255,255,255,.075);border-radius:22px;padding:20px;box-shadow:0 22px 60px rgba(0,0,0,.28)}
h1{font-size:23px;margin:0 0 6px;letter-spacing:-.025em}.muted{font-size:13px;line-height:1.5;color:#969dad}.field{margin-top:16px}.field label{display:block;font-size:12px;color:#a6adbb;margin-bottom:7px}.input{width:100%;min-height:48px;border-radius:14px;border:1px solid #2b3040;background:#0b0e15;color:#fff;padding:13px 14px;font-size:16px;outline:none}.input:focus{border-color:#8b5cf6;box-shadow:0 0 0 3px rgba(139,92,246,.13)}
.btn{width:100%;min-height:48px;border:0;border-radius:14px;margin-top:18px;background:linear-gradient(135deg,#9b6bff,#6d28d9);color:#fff;font-size:15px;font-weight:850}.btn:disabled{opacity:.5}.btn:active{transform:scale(.985)}
.msg{min-height:18px;margin-top:11px;font-size:12px;color:#aeb5c3}.msg.bad{color:#ff9d9d}.foot{text-align:center;margin-top:18px;font-size:13px;color:#929aaa}.foot a{color:#d2c6ff;font-weight:800;text-decoration:none}
.notice{margin-top:14px;padding:12px;border-radius:14px;background:rgba(126,77,255,.09);border:1px solid rgba(158,120,255,.15);font-size:12px;color:#b7bdca;line-height:1.45}
a,button,input{touch-action:manipulation;-webkit-tap-highlight-color:transparent}
</style></head>
<body><main>
<div class="brand"><div class="logo"><img src="/ar-payment/payping-icon-v4.svg" alt=""></div><div><div class="title">PayPing!</div><div class="sub">Create your account</div></div></div>
<section class="card">
<h1>Create account</h1><div class="muted">Account baru bermula sebagai user. Role owner hanya boleh diperoleh melalui device Telegram owner yang sah.</div>
<div class="field"><label for="name">Display name</label><input id="name" class="input" autocomplete="name" maxlength="80" placeholder="Your name"></div>
<div class="field"><label for="email">Email</label><input id="email" class="input" type="email" inputmode="email" autocomplete="email" placeholder="name@example.com"></div>
<div class="field"><label for="password">Password</label><input id="password" class="input" type="password" autocomplete="new-password" placeholder="Minimum 8 characters"></div>
<div class="field"><label for="confirm">Confirm password</label><input id="confirm" class="input" type="password" autocomplete="new-password" placeholder="Repeat password"></div>
<div id="notice" class="notice" hidden>Device ini sudah connected dengan Telegram. PayPing akan link account baru kepada Telegram ID tersebut secara automatik.</div>
<button id="register" class="btn">Create Account</button><div id="msg" class="msg"></div>
<div class="foot">Dah ada account? <a href="/ar-payment/login">Login</a></div>
</section>
</main>
<script>
const key='ar_payment_device_token_v1';const device=localStorage.getItem(key)||'';const $=id=>document.getElementById(id);
const headers=()=>device?{'Content-Type':'application/json','X-PayPing-Device-Token':device}:{'Content-Type':'application/json'};
if(device)$('notice').hidden=false;
async function existing(){try{const r=await fetch('/api/payping-auth',{headers:headers()});if(r.ok)location.replace('/ar-payment/')}catch{}}
function msg(t,bad=false){$('msg').textContent=t||'';$('msg').className='msg'+(bad?' bad':'')}
$('register').addEventListener('click',async()=>{try{
 const password=$('password').value;if(password!==$('confirm').value)throw new Error('Password confirmation tak sama.');
 $('register').disabled=true;msg('Creating account…');
 const r=await fetch('/api/payping-auth',{method:'POST',headers:headers(),body:JSON.stringify({action:'register',displayName:$('name').value.trim(),email:$('email').value.trim(),password})});
 const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.message||'Register gagal.');
 msg('Account siap ✅');location.replace('/ar-payment/');
}catch(e){msg(e.message||String(e),true)}finally{$('register').disabled=false}});
$('confirm').addEventListener('keydown',e=>{if(e.key==='Enter')$('register').click()});
existing();
</script></body></html>`;

function send(res,type,body){res.statusCode=200;res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');res.end(body)}
export default function payPingRegisterPage(req,res){
 if(req.method!=='GET'&&req.method!=='HEAD')return res.status(405).send('Method Not Allowed');
 return send(res,'text/html; charset=utf-8',req.method==='HEAD'?'':PAGE);
}
