import {
  disconnectPushDevice,
  getPushDeviceContext,
  getPushNotificationHistory,
  revokePushDevice,
  sendWebPushTest,
} from '../src/support/webpush-payment.js';
import { telegram } from '../src/telegram.js';
import { resolvePayPingIdentity, payPingBearerToken } from '../src/payping/identity.js';

function json(res,status,body){return res.status(status).json(body)}
async function contextFrom(req){
  const identity=await resolvePayPingIdentity(req);
  if(!identity)return null;
  const token=payPingBearerToken(req);
  const device=identity.authType==='device'
    ? await getPushDeviceContext(token)
    : null;
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
  if(!ctx)return json(res,401,{ok:false,error:'PAYPING_NOT_AUTHENTICATED'});

  try{
    if(req.method==='GET'){
      const view=String(req.query?.view||'account').trim().toLowerCase();
      const owner=Boolean(ctx.identity.owner);

      if(view==='notifications'){
        if(!ctx.device){
          return json(res,200,{
            ok:true,
            owner,
            device:{devices:[],activeDeviceCount:0},
            history:[],
            notificationConfigured:false,
          });
        }
        const history=await getPushNotificationHistory(ctx.token,req.query?.limit||50);
        return json(res,200,{
          ok:true,
          owner,
          device:ctx.device,
          history,
          notificationConfigured:true,
        });
      }

      const profile=ctx.identity.account
        ? {
          userId:String(ctx.identity.userId||''),
          firstName:'',
          lastName:'',
          username:'',
          displayName:ctx.identity.account.displayName||ctx.identity.account.email||'PayPing User',
          email:ctx.identity.account.email||'',
        }
        : await accountProfile(ctx.identity.userId);
      return json(res,200,{
        ok:true,
        owner,
        role:ctx.identity.role,
        profile,
        device:ctx.device||{devices:[],activeDeviceCount:0},
        environment:String(process.env.BAYARCASH_SANDBOX||'').toLowerCase()==='true'?'sandbox':'production',
      });
    }

    if(req.method!=='POST'){
      res.setHeader('Allow','GET, POST');
      return json(res,405,{ok:false,error:'method_not_allowed'});
    }

    const body=req.body&&typeof req.body==='object'?req.body:{};
    const action=String(body.action||'').trim().toLowerCase();
    if(!ctx.device){
      return json(res,400,{ok:false,error:'DEVICE_TOKEN_REQUIRED',message:'Connect notifications pada device ini dahulu.'});
    }

    if(action==='test_notification'){
      const result=await sendWebPushTest(ctx.token);
      return json(res,200,{ok:true,...result});
    }

    if(action==='disconnect_current'){
      await disconnectPushDevice(ctx.token);
      return json(res,200,{ok:true,disconnected:true,currentDevice:true});
    }

    if(action==='revoke_device'){
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
