const BASE_STYLE = `
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 15% 0,#2c1255 0,#11111b 40%,#07070d 100%);color:#f8f8fb;display:grid;place-items:center;padding:22px}
.shell{width:min(100%,430px)}.brand{display:flex;align-items:center;justify-content:center;gap:11px;margin-bottom:20px}.logo{width:50px;height:50px;border-radius:16px;overflow:hidden}.logo img{width:100%;height:100%}.brandName{font-size:25px;font-weight:950;letter-spacing:-.5px}
.card{background:rgba(18,21,30,.9);border:1px solid rgba(255,255,255,.08);border-radius:24px;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.4);backdrop-filter:blur(18px)}
h1{font-size:23px;margin:0 0 5px}p{color:#989faf;line-height:1.55;font-size:13px;margin:0 0 18px}.field{margin-bottom:12px}.field label{display:block;font-size:11px;color:#969dad;margin:0 0 6px}
input{width:100%;border:1px solid #2c3240;background:#0b0e15;color:#fff;border-radius:13px;padding:13px 14px;font-size:15px;outline:none}input:focus{border-color:#8b5cf6}
button,.btn{width:100%;border:0;border-radius:14px;padding:13px 15px;font-size:14px;font-weight:900;color:#fff;background:linear-gradient(135deg,#9b6bff,#6d28d9);cursor:pointer;text-decoration:none;display:block;text-align:center}
button:disabled{opacity:.45}.secondary{background:#202532}.msg{font-size:12px;min-height:18px;margin-top:11px;color:#aeb5c3}.msg.bad{color:#ff9c9c}.msg.ok{color:#7be3ad}
.switch{text-align:center;margin-top:15px;color:#949baa;font-size:12px}.switch a{color:#d7ccff;text-decoration:none;font-weight:850}
.steps{background:#0b0e15;border:1px solid rgba(255,255,255,.06);border-radius:15px;padding:14px;margin:12px 0 16px}.steps div{font-size:13px;line-height:1.55;margin:5px 0}.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#d8ceff}.tiny{font-size:11px;color:#7f8796;margin-top:10px;text-align:center}
`;

function shell(title, subtitle, body, script) {
  return `<!doctype html><html lang="ms"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#6d28d9"><title>${title} · PayPing!</title><link rel="icon" href="/ar-payment/payping-icon-v4.svg"><style>${BASE_STYLE}</style></head><body><div class="shell"><div class="brand"><div class="logo"><img src="/ar-payment/payping-icon-v4.svg" alt=""></div><div class="brandName">PayPing!</div></div><div class="card"><h1>${title}</h1><p>${subtitle}</p>${body}</div></div><script>${script}</script></body></html>`;
}

const commonScript = `
const AUTH_KEY='payping_auth_session_v1';
const $=id=>document.getElementById(id);
const setMsg=(text,bad=false)=>{const el=$('msg');if(!el)return;el.textContent=text||'';el.className='msg '+(bad?'bad':'ok')};
async function authFetch(body,token=''){const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;const r=await fetch('/api/payping-auth',{method:'POST',headers,body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.message||d.error||'Request failed');return d}
async function routeSession(){const token=localStorage.getItem(AUTH_KEY)||'';if(!token)return false;try{const r=await fetch('/api/payping-auth',{headers:{Authorization:'Bearer '+token}});const d=await r.json();if(!r.ok||!d.ok)throw new Error('expired');location.href=d.account.telegramLinked?'/ar-payment/':'/ar-payment/onboarding';return true}catch{localStorage.removeItem(AUTH_KEY);return false}}
`;

const loginBody = `
<form id="form"><div class="field"><label>Email</label><input id="email" type="email" autocomplete="email" required placeholder="you@example.com"></div><div class="field"><label>Password</label><input id="password" type="password" autocomplete="current-password" required placeholder="••••••••"></div><button id="submit" type="submit">Login</button><div id="msg" class="msg"></div></form><div class="switch">Belum ada akaun? <a href="/ar-payment/register">Create account</a></div>`;
const loginScript = commonScript + `
routeSession();$('form').addEventListener('submit',async e=>{e.preventDefault();$('submit').disabled=true;setMsg('Signing in…');try{const d=await authFetch({action:'login',email:$('email').value,password:$('password').value});localStorage.setItem(AUTH_KEY,d.sessionToken);location.href=d.account.telegramLinked?'/ar-payment/':'/ar-payment/onboarding'}catch(err){setMsg(err.message,true);$('submit').disabled=false}});
`;

const registerBody = `
<form id="form"><div class="field"><label>Name</label><input id="name" autocomplete="name" maxlength="100" placeholder="Nama anda"></div><div class="field"><label>Email</label><input id="email" type="email" autocomplete="email" required placeholder="you@example.com"></div><div class="field"><label>Password</label><input id="password" type="password" autocomplete="new-password" minlength="8" required placeholder="Minimum 8 aksara"></div><button id="submit" type="submit">Create PayPing Account</button><div id="msg" class="msg"></div></form><div class="switch">Sudah ada akaun? <a href="/ar-payment/login">Login</a></div>`;
const registerScript = commonScript + `
routeSession();$('form').addEventListener('submit',async e=>{e.preventDefault();$('submit').disabled=true;setMsg('Creating account…');try{const d=await authFetch({action:'register',displayName:$('name').value,email:$('email').value,password:$('password').value});localStorage.setItem(AUTH_KEY,d.sessionToken);location.href='/ar-payment/onboarding'}catch(err){setMsg(err.message,true);$('submit').disabled=false}});
`;

const onboardingBody = `
<div class="steps"><div><b>1.</b> Buka Telegram bot yang sama digunakan untuk PayPing.</div><div><b>2.</b> Send <span class="code">/pushsetup</span>.</div><div><b>3.</b> Copy setup code 8 digit dan masukkan di bawah.</div></div><div class="field"><label>Telegram setup code</label><input id="code" inputmode="numeric" maxlength="8" placeholder="12345678"></div><button id="link">Connect Telegram & Continue</button><button id="logout" class="secondary" style="margin-top:9px">Logout</button><div id="msg" class="msg"></div><div class="tiny">Code hanya digunakan untuk sahkan Telegram ID. Selepas linked, affiliate data lama anda kekal pada ID yang sama.</div>`;
const onboardingScript = commonScript + `
(async()=>{const token=localStorage.getItem(AUTH_KEY)||'';if(!token){location.href='/ar-payment/login';return}try{const r=await fetch('/api/payping-auth',{headers:{Authorization:'Bearer '+token}});const d=await r.json();if(!r.ok||!d.ok)throw new Error('expired');if(d.account.telegramLinked){location.href='/ar-payment/';return}}catch{localStorage.removeItem(AUTH_KEY);location.href='/ar-payment/login'}})();
$('link').addEventListener('click',async()=>{const token=localStorage.getItem(AUTH_KEY)||'';$('link').disabled=true;setMsg('Connecting Telegram…');try{const d=await authFetch({action:'link_telegram',code:$('code').value.trim()},token);setMsg(d.account.isAdmin?'Admin account connected ✅':'Account connected ✅');setTimeout(()=>location.href='/ar-payment/',350)}catch(err){setMsg(err.message,true);$('link').disabled=false}});
$('logout').addEventListener('click',async()=>{const token=localStorage.getItem(AUTH_KEY)||'';try{await authFetch({action:'logout'},token)}catch{}localStorage.removeItem(AUTH_KEY);location.href='/ar-payment/login'});
`;

const LOGIN_PAGE = shell('Welcome back', 'Login ke PayPing untuk akses dashboard anda.', loginBody, loginScript);
const REGISTER_PAGE = shell('Create account', 'Satu akaun untuk affiliate, payment history dan PayPing dashboard.', registerBody, registerScript);
const ONBOARDING_PAGE = shell('Connect Telegram', 'Sahkan Telegram anda supaya PayPing boleh sambung terus kepada affiliate profile yang sedia ada.', onboardingBody, onboardingScript);

function send(res, body) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

export function payPingLoginPage(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).send('Method Not Allowed');
  return send(res, req.method === 'HEAD' ? '' : LOGIN_PAGE);
}

export function payPingRegisterPage(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).send('Method Not Allowed');
  return send(res, req.method === 'HEAD' ? '' : REGISTER_PAGE);
}

export function payPingOnboardingPage(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).send('Method Not Allowed');
  return send(res, req.method === 'HEAD' ? '' : ONBOARDING_PAGE);
}
