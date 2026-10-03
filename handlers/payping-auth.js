import {
  authenticatePayPingAccount,
  clearPayPingSessionCookie,
  createPayPingAccount,
  issuePayPingSession,
  linkTrustedTelegram,
  payPingSessionCookie,
  payPingSessionTokenFromRequest,
  resolvePayPingIdentity,
  revokePayPingSession,
  trustedTelegramFromRequest,
} from '../src/payping/auth.js';

function json(res,status,body){
  res.setHeader('Cache-Control','no-store');
  return res.status(status).json(body);
}

async function maybeLinkTrusted(account, req) {
  const trusted = await trustedTelegramFromRequest(req);
  if (!trusted || !account) return { account, linked: false, warning: '' };
  try {
    const linked = await linkTrustedTelegram(account.accountId, trusted.userId, {
      promoteOwner: trusted.owner,
    });
    return { account: linked || account, linked: true, warning: '' };
  } catch (error) {
    return { account, linked: false, warning: String(error?.code || 'TELEGRAM_LINK_SKIPPED') };
  }
}

export default async function handler(req,res){
  try{
    if(req.method==='GET'){
      let identity=await resolvePayPingIdentity(req,{allowLegacyDevice:false});
      if(!identity)return json(res,401,{ok:false,error:'PAYPING_LOGIN_REQUIRED'});
      const linked=await maybeLinkTrusted(identity.account,req);
      if(linked.account!==identity.account){
        identity={...identity,account:linked.account,role:linked.account.role,userId:linked.account.telegramUserId,owner:['owner','admin'].includes(linked.account.role),needsTelegramLink:!linked.account.telegramUserId};
      }
      return json(res,200,{
        ok:true,
        account:identity.account,
        role:identity.role,
        owner:identity.owner,
        needsTelegramLink:identity.needsTelegramLink,
        linkWarning:linked.warning||undefined,
      });
    }

    if(req.method!=='POST'){
      res.setHeader('Allow','GET, POST');
      return json(res,405,{ok:false,error:'method_not_allowed'});
    }

    const body=req.body&&typeof req.body==='object'?req.body:{};
    const action=String(body.action||'').trim().toLowerCase();

    if(action==='logout'){
      const token=payPingSessionTokenFromRequest(req);
      if(token)await revokePayPingSession(token).catch(()=>{});
      res.setHeader('Set-Cookie',clearPayPingSessionCookie());
      return json(res,200,{ok:true,loggedOut:true});
    }

    if(action==='register'){
      const trusted=await trustedTelegramFromRequest(req);
      const account=await createPayPingAccount({
        email:body.email,
        password:body.password,
        displayName:body.displayName||'',
        trustedTelegramUserId:trusted?.userId||'',
        role:trusted?.owner?'owner':'user',
      });
      const session=await issuePayPingSession(account.accountId);
      res.setHeader('Set-Cookie',payPingSessionCookie(session.token,session.expiresAt));
      return json(res,201,{
        ok:true,
        account,
        role:account.role,
        owner:['owner','admin'].includes(account.role),
        needsTelegramLink:!account.telegramUserId,
      });
    }

    if(action==='login'){
      let account=await authenticatePayPingAccount(body.email,body.password);
      if(!account)return json(res,401,{ok:false,error:'INVALID_LOGIN',message:'Email atau password tidak betul.'});

      const linked=await maybeLinkTrusted(account,req);
      account=linked.account;
      const session=await issuePayPingSession(account.accountId);
      res.setHeader('Set-Cookie',payPingSessionCookie(session.token,session.expiresAt));
      return json(res,200,{
        ok:true,
        account,
        role:account.role,
        owner:['owner','admin'].includes(account.role),
        needsTelegramLink:!account.telegramUserId,
        linkWarning:linked.warning||undefined,
      });
    }

    return json(res,400,{ok:false,error:'unknown_action'});
  }catch(error){
    const code=String(error?.code||'PAYPING_AUTH_FAILED');
    const status={
      INVALID_EMAIL:400,
      INVALID_PASSWORD:400,
      EMAIL_ALREADY_EXISTS:409,
      TELEGRAM_ALREADY_LINKED:409,
      ACCOUNT_ALREADY_LINKED:409,
    }[code]||500;
    if(status>=500)console.error('[payping-auth] failed:',code,error?.message);
    return json(res,status,{ok:false,error:code,message:error?.message||'PayPing authentication failed.'});
  }
}
