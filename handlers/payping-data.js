import { getPayPingAnalytics, getPayPingAnalyticsExport, getPayPingDashboard, getPayPingTransactionDetail, listPayPingTransactions } from '../src/payping/dashboard.js';
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
    if(view==='analytics'){
      if(!auth.owner)return json(res,403,{ok:false,error:'PAYPING_OWNER_ONLY'});
      const analytics=await getPayPingAnalytics({
        ...auth,
        range:req.query?.range||'30d',
      });
      return json(res,200,{ok:true,...auth,...analytics});
    }
    if(view==='analytics-export'){
      if(!auth.owner)return json(res,403,{ok:false,error:'PAYPING_OWNER_ONLY'});
      const report=await getPayPingAnalyticsExport({
        ...auth,
        range:req.query?.range||'30d',
        limit:req.query?.limit||5000,
      });
      return json(res,200,{ok:true,...auth,...report});
    }
    if(view==='transaction'){
      const detail=await getPayPingTransactionDetail({
        ...auth,
        orderNumber:req.query?.order||'',
      });
      if(!detail)return json(res,404,{ok:false,error:'TRANSACTION_NOT_FOUND'});
      return json(res,200,{ok:true,...auth,...detail});
    }
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
    const code=String(error?.code||'PAYPING_DATA_FAILED');
    const status=code==='PAYPING_OWNER_ONLY'?403:500;
    return json(res,status,{ok:false,error:code,message:error?.message||'PayPing data failed.'});
  }
}
