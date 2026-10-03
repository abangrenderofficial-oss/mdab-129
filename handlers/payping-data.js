import { getPayPingDashboard, listPayPingTransactions } from '../src/payping/dashboard.js';
import { resolvePushDeviceOwner } from '../src/support/webpush-payment.js';

function json(res,status,body){return res.status(status).json(body)}
function bearer(req){
  const raw=String(req?.headers?.authorization||'').trim();
  const m=raw.match(/^Bearer\s+(.+)$/i);
  return String(m?.[1]||req?.headers?.['x-payping-device-token']||'').trim();
}
async function identity(req){
  const token=bearer(req);
  if(!token)return null;
  const userId=await resolvePushDeviceOwner(token);
  if(!userId)return null;
  const ownerId=String(process.env.BOT_OWNER_ID||'').trim();
  return {userId,owner:Boolean(ownerId&&userId===ownerId)};
}

export default async function handler(req,res){
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return json(res,405,{ok:false,error:'method_not_allowed'});
  }
  const auth=await identity(req);
  if(!auth)return json(res,401,{ok:false,error:'PAYPING_DEVICE_NOT_AUTHENTICATED'});
  try{
    const view=String(req.query?.view||'dashboard').trim().toLowerCase();
    if(view==='transactions'){
      const transactions=await listPayPingTransactions({
        ...auth,
        status:req.query?.status||'ALL',
        search:req.query?.search||'',
        limit:req.query?.limit||50,
      });
      return json(res,200,{ok:true,...auth,transactions});
    }
    return json(res,200,{ok:true,...auth,...await getPayPingDashboard(auth)});
  }catch(error){
    console.error('[payping-data] failed:',error?.message);
    return json(res,500,{ok:false,error:'PAYPING_DATA_FAILED',message:error?.message||'PayPing data failed.'});
  }
}
