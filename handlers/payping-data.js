import { getPayPingAnalytics, getPayPingAnalyticsExport, getPayPingDashboard, getPayPingTransactionDetail, listPayPingTransactions } from '../src/payping/dashboard.js';
import { resolvePayPingIdentity } from '../src/payping/auth.js';
import { getPayPingBot, listPayPingBotAffiliates, listPayPingBots } from '../src/payping/catalog.js';
import {
  reconcilePaymentFollowup,
  sendPaymentFollowup,
  stopPaymentFollowup,
} from '../src/support/payment-followup.js';

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
  if(!['GET','POST'].includes(req.method)){
    res.setHeader('Allow','GET, POST');
    return json(res,405,{ok:false,error:'method_not_allowed'});
  }
  const auth=await identity(req);
  if(!auth)return json(res,401,{ok:false,error:'PAYPING_LOGIN_REQUIRED'});
  if(auth.needsTelegramLink&&!auth.owner)return json(res,409,{ok:false,error:'PAYPING_TELEGRAM_LINK_REQUIRED',role:auth.role,needsTelegramLink:true});
  try{
    if(req.method==='POST'){
      const body=req.body&&typeof req.body==='object'?req.body:{};
      const action=String(body.action||'').trim().toLowerCase();
      const order=String(body.order||'').trim();
      if(!order)return json(res,400,{ok:false,error:'ORDER_REQUIRED'});

      const affiliateActor=!auth.owner&&String(auth.role||'').toLowerCase()==='affiliate';
      if(!auth.owner&&!affiliateActor)return json(res,403,{ok:false,error:'PAYPING_FOLLOWUP_FORBIDDEN'});

      const scopedDetail=await getPayPingTransactionDetail({...auth,orderNumber:order});
      if(!scopedDetail)return json(res,404,{ok:false,error:'TRANSACTION_NOT_FOUND'});

      let actionResult=null;
      if(action==='payment_followup_send'){
        actionResult=await sendPaymentFollowup(order,{
          manual:true,
          actorRole:auth.owner?'owner':'affiliate',
          actorUserId:auth.userId,
        });
      }else if(action==='payment_followup_check'){
        actionResult=await reconcilePaymentFollowup(order);
      }else if(action==='payment_followup_stop'){
        if(!auth.owner)return json(res,403,{ok:false,error:'PAYPING_OWNER_ONLY'});
        actionResult=await stopPaymentFollowup(order,'OWNER_STOPPED');
      }else{
        return json(res,400,{ok:false,error:'UNKNOWN_PAYPING_ACTION'});
      }

      const detail=await getPayPingTransactionDetail({...auth,orderNumber:order});
      return json(res,200,{ok:true,...auth,actionResult,...detail});
    }

    const view=String(req.query?.view||'dashboard').trim().toLowerCase();
    if(view==='bots'){
      if(!auth.owner)return json(res,403,{ok:false,error:'PAYPING_OWNER_ONLY'});
      return json(res,200,{ok:true,...auth,bots:await listPayPingBots()});
    }
    if(view==='bot'){
      if(!auth.owner)return json(res,403,{ok:false,error:'PAYPING_OWNER_ONLY'});
      const bot=await getPayPingBot(req.query?.bot||'');
      if(!bot)return json(res,404,{ok:false,error:'PAYPING_BOT_NOT_FOUND'});
      return json(res,200,{ok:true,...auth,bot});
    }
    if(view==='bot-affiliates'){
      if(!auth.owner)return json(res,403,{ok:false,error:'PAYPING_OWNER_ONLY'});
      const data=await listPayPingBotAffiliates(req.query?.bot||'',{limit:req.query?.limit||100});
      if(!data)return json(res,404,{ok:false,error:'PAYPING_BOT_NOT_FOUND'});
      return json(res,200,{ok:true,...auth,...data});
    }
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
    const status=['PAYPING_OWNER_ONLY','PAYMENT_FOLLOWUP_FORBIDDEN','PAYPING_FOLLOWUP_FORBIDDEN'].includes(code)
      ?403
      :['PAYMENT_FOLLOWUP_COOLDOWN','PAYMENT_FOLLOWUP_LIMIT'].includes(code)
        ?429
        :500;
    return json(res,status,{
      ok:false,
      error:code,
      message:error?.message||'PayPing data failed.',
      retryAt:error?.retryAt||null,
    });
  }
}
