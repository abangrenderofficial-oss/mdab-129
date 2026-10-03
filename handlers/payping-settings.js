import {
  disconnectPushDevice,
  getPushDeviceContext,
  getPushNotificationHistory,
  revokePushDevice,
  sendWebPushTest,
} from '../src/support/webpush-payment.js';
import { telegram } from '../src/telegram.js';

function json(res,status,body){return res.status(status).json(body)}
function bearer(req){
  const raw=String(req?.headers?.authorization||'').trim();
  const match=raw.match(/^Bearer\s+(.+)$/i);
  return String(match?.[1]||req?.headers?.['x-payping-device-token']||'').trim();
}
async function contextFrom(req){
  const token=bearer(req);
  if(!token)return null;
  const device=await getPushDeviceContext(token);
  if(!device)return null;
  return {token,device};
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
      const ownerId=String(process.env.BOT_OWNER_ID||'').trim();
      const owner=Boolean(ownerId&&ctx.device.ownerUserId===ownerId);

      if(view==='notifications'){
        const history=await getPushNotificationHistory(ctx.token,req.query?.limit||50);
        return json(res,200,{
          ok:true,
          owner,
          device:ctx.device,
          history,
          notificationConfigured:true,
        });
      }

      const profile=await accountProfile(ctx.device.ownerUserId);
      return json(res,200,{
        ok:true,
        owner,
        profile,
        device:ctx.device,
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
