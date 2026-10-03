import { getPayPingAnalytics, getPayPingAnalyticsExport, getPayPingDashboard, getPayPingTransactionDetail, listPayPingTransactions } from '../src/payping/dashboard.js';
import { resolvePayPingIdentity } from '../src/payping/auth.js';

function json(res,status,body){return res.status(status).json(body)}
async function identity(req){
  const auth=await resolvePayPingIdentity(req,{allowLegacyDevice:true});
  if(!auth)return null;
  return {
    userId:String(auth.userId||''),
    owner:Boolean(auth.owner),
    role:String(auth.role||'user'),
    accountId:String(auth.accountId||''),
    source:String(auth.source||''),
    needsTelegramLink:Boolean(auth.needsTelegramLink),
  };
}

export default async function handler(req,res){
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return json(res,405,{ok:false,error:'method_not_allowed'});
  }
  const auth=await identity(req);
  if(!auth)return json(res,401,{ok:false,error:'PAYPING_LOGIN_REQUIRED'});
  if(auth.needsTelegramLink&&!auth.owner)return json(res,409,{ok:false,error:'PAYPING_TELEGRAM_LINK_REQUIRED',role:auth.role,needsTelegramLink:true});
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
