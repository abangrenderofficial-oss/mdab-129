import { unlink, readFile } from 'node:fs/promises';

const dbPath=`/tmp/payping-auth-selftest-${process.pid}.db`;
await unlink(dbPath).catch(()=>{});
process.env.TURSO_DATABASE_URL=`file:${dbPath}`;
process.env.TURSO_AUTH_TOKEN='local-selftest';
process.env.BAYARCASH_SANDBOX='true';

const {
  authenticatePayPingAccount,
  clearPayPingSessionCookie,
  createPayPingAccount,
  ensurePayPingAuthSchema,
  issuePayPingSession,
  linkTrustedTelegram,
  payPingSessionCookie,
  resolvePayPingSession,
  revokePayPingSession,
} = await import('../src/payping/auth.js');

function assert(v,m){if(!v)throw new Error(m)}
function must(source,needle,label){if(!source.includes(needle))throw new Error(`${label} missing ${needle}`)}

await ensurePayPingAuthSchema();

const user=await createPayPingAccount({
  email:'User@Test.Example',
  password:'StrongPass123!',
  displayName:'Test User',
});
assert(user.email==='user@test.example','email normalization failed');
assert(user.role==='user','public account must default to user');
assert(user.telegramUserId==='','public account must begin unlinked without trusted Telegram');

let duplicate=false;
try{await createPayPingAccount({email:'user@test.example',password:'AnotherPass123!'})}
catch(error){duplicate=error?.code==='EMAIL_ALREADY_EXISTS'}
assert(duplicate,'duplicate email must be rejected');

const wrong=await authenticatePayPingAccount('user@test.example','wrong-password');
assert(wrong===null,'wrong password must fail');
const authenticated=await authenticatePayPingAccount('user@test.example','StrongPass123!');
assert(authenticated?.accountId===user.accountId,'valid login failed');

const linked=await linkTrustedTelegram(user.accountId,'123456789');
assert(linked.telegramUserId==='123456789','trusted Telegram linking failed');
assert(linked.role==='user','normal Telegram link must not escalate role');

const session=await issuePayPingSession(user.accountId);
const resolved=await resolvePayPingSession(session.token);
assert(resolved?.accountId===user.accountId,'session resolution failed');
const cookie=payPingSessionCookie(session.token,session.expiresAt);
assert(cookie.includes('HttpOnly')&&cookie.includes('Secure')&&cookie.includes('SameSite=Lax'),'secure session cookie flags missing');
assert(clearPayPingSessionCookie().includes('Max-Age=0'),'logout cookie must expire');
assert(await revokePayPingSession(session.token),'session revoke failed');
assert(await resolvePayPingSession(session.token)===null,'revoked session remained valid');

const owner=await createPayPingAccount({
  email:'owner@test.example',
  password:'OwnerPass123!',
  trustedTelegramUserId:'987654321',
  role:'owner',
});
assert(owner.role==='owner'&&owner.telegramUserId==='987654321','trusted owner bootstrap failed');

const [handler,login,register,settings,server,router,vercel]=await Promise.all([
  readFile('handlers/payping-auth.js','utf8'),
  readFile('handlers/payping-login-pwa.js','utf8'),
  readFile('handlers/payping-register-pwa.js','utf8'),
  readFile('handlers/payping-settings-pwa.js','utf8'),
  readFile('server.js','utf8'),
  readFile('api/router.js','utf8'),
  readFile('vercel.json','utf8'),
]);
must(handler,"action==='register'",'auth register');
must(handler,"action==='login'",'auth login');
must(handler,"action==='logout'",'auth logout');
must(handler,'trustedTelegramFromRequest','trusted Telegram bridge');
must(login,"fetch('/api/payping-auth'",'login UI');
must(register,"action:'register'",'register UI');
must(settings,'PayPing Account','settings account section');
must(settings,'/ar-payment/login','settings login link');
must(server,"['/api/payping-auth', payPingAuthHandler]",'Node auth API route');
must(server,"['/ar-payment/login', payPingLoginPage]",'Node login route');
must(server,"['/ar-payment/register', payPingRegisterPage]",'Node register route');
must(router,"['payping-auth', payPingAuthHandler]",'Vercel auth route');
const cfg=JSON.parse(vercel);
for(const source of ['/api/payping-auth','/ar-payment/login','/ar-payment/register']){
  assert(cfg.rewrites.some(x=>x.source===source),`Vercel rewrite missing ${source}`);
}

console.log('PAYPING_AUTH_SELFTEST_OK',JSON.stringify({
  account:user.accountId,
  telegram:linked.telegramUserId,
  ownerRole:owner.role,
  duplicateBlocked:duplicate,
  sessionRevoked:true,
}));
