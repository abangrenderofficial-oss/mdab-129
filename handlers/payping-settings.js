import {
  disconnectPushDevice,
  getPushDeviceContext,
  getPushNotificationHistory,
  revokePushDevice,
  sendWebPushTest,
} from '../src/support/webpush-payment.js';
import { telegram } from '../src/telegram.js';
import { resolvePayPingIdentity } from '../src/payping/auth.js';

function json(res,status,body){return res.status(status).json(body)}
function deviceToken(req){
  const direct=String(req?.headers?.['x-payping-device-token']||'').trim();
  if(direct)return direct;
  const raw=String(req?.headers?.authorization||'').trim();
  const match=raw.match(/^Bearer\s+(.+)$/i);
  return String(match?.[1]||'').trim();
}
async function contextFrom(req){
  const identity=await resolvePayPingIdentity(req,{allowLegacyDevice:true});
  if(!identity)return null;
  const token=deviceToken(req);
  const device=token?await getPushDeviceContext(token).catch(()=>null):null;
  return {token,device,identity};
}
async function accountProfile(userId){
  try{
    const chat=await telegram('getChat',{chat_id:userId});
    return {
      userId:String(userId||''),
      firstName:String(chat?.first_name||''),
      lastName:String(chat?.last_name||''),
      username:String(chat?.username||'').replace(/^@+/,''),
      displayName:[chat?.first_name,chat?.last_name].filter(Boolean).join(' ').trim()
        || (chat?.username?('@'+String(chat.username).replace(/^@+/,'')):'PayPing Owner'),
    };
  }catch{
    return {userId:String(userId||''),firstName:'',lastName:'',username:'',displayName:'PayPing Owner'};
  }
}

export default async function handler(req,res){
  const ctx=await contextFrom(req);
  if(!ctx)return json(res,401,{ok:false,error:'PAYPING_DEVICE_NOT_AUTHENTICATED'});

  try{
    if(req.method==='GET'){
      const view=String(req.query?.view||'account').trim().toLowerCase();
      const owner=Boolean(ctx.identity.owner);

      if(view==='notifications'){
        const history=ctx.token?await getPushNotificationHistory(ctx.token,req.query?.limit||50).catch(()=>[]):[];
        return json(res,200,{
          ok:true,
          owner,
          role:ctx.identity.role,
          account:ctx.identity.account,
          device:ctx.device||{ownerUserId:ctx.identity.userId||'',currentDeviceId:'',devices:[],activeDeviceCount:0},
          history,
          notificationConfigured:Boolean(ctx.device),
        });
      }

      const profile=ctx.identity.userId
        ? await accountProfile(ctx.identity.userId)
        : {
            userId:'',
            firstName:'',
            lastName:'',
            username:'',
            displayName:String(ctx.identity.account?.displayName||ctx.identity.account?.email||'PayPing User'),
          };
      return json(res,200,{
        ok:true,
        owner,
        role:ctx.identity.role,
        account:ctx.identity.account,
        needsTelegramLink:ctx.identity.needsTelegramLink,
        profile,
        device:ctx.device||{ownerUserId:ctx.identity.userId||'',currentDeviceId:'',devices:[],activeDeviceCount:0},
        environment:String(process.env.BAYARCASH_SANDBOX||'').toLowerCase()==='true'?'sandbox':'production',
      });
    }

    if(req.method!=='POST'){
      res.setHeader('Allow','GET, POST');
      return json(res,405,{ok:false,error:'method_not_allowed'});
    }

    const body=req.body&&typeof req.body==='object'?req.body:{};
    const action=String(body.action||'').trim().toLowerCase();

    if(action==='test_notification'){
      if(!ctx.token)return json(res,400,{ok:false,error:'PAYPING_DEVICE_NOT_CONNECTED'});
      const result=await sendWebPushTest(ctx.token);
      return json(res,200,{ok:true,...result});
    }

    if(action==='disconnect_current'){
      if(!ctx.token)return json(res,400,{ok:false,error:'PAYPING_DEVICE_NOT_CONNECTED'});
      await disconnectPushDevice(ctx.token);
      return json(res,200,{ok:true,disconnected:true,currentDevice:true});
    }

    if(action==='revoke_device'){
      if(!ctx.token)return json(res,400,{ok:false,error:'PAYPING_DEVICE_NOT_CONNECTED'});
      const result=await revokePushDevice(ctx.token,body.deviceId);
      return json(res,200,{ok:true,...result});
    }

    return json(res,400,{ok:false,error:'unknown_action'});
  }catch(error){
    const code=String(error?.code||'PAYPING_SETTINGS_FAILED');
    const status=['DEVICE_TOKEN_MISSING','PUSH_DEVICE_NOT_FOUND'].includes(code)?400:500;
    console.warn('[payping-settings] failed:',code,error?.message);
    return json(res,status,{ok:false,error:code,message:error?.message||'PayPing settings failed.'});
  }
}
