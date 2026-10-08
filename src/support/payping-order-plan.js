import {currentSupportEnvironment,getSupportDb} from './store.js';
import {isPayPingSharedConfigEnabled} from './payping-shared-config.js';

const fallback=new Set([10,20,30,50,100]);
/** Immutable duration snapshot for NEW checkouts only. Existing paid supporters
 * retain legacy 1 calendar-year expiry if no snapshot exists. */
export async function recordMediaXSupportPlanForOrder(orderNumber,amount){
 if(!isPayPingSharedConfigEnabled())return false;
 const order=String(orderNumber||'').trim();
 const cents=Math.round(Number(amount)*100);
 if(!/^[A-Za-z0-9_-]{8,90}$/.test(order)||!Number.isInteger(cents)||cents<100)throw new Error('Invalid order or amount for plan snapshot');
 const db=await getSupportDb(),env=currentSupportEnvironment();
 const result=await db.execute({sql:"SELECT plan_id,amount_cents,duration_days,status FROM payping_plans WHERE environment=? AND bot_id='mediax'",args:[env]});
 const list=result.rows||[];
 const match=list.find(x=>x.status==='active'&&Number(x.amount_cents)===cents);
 if(!match && (list.length>0||!fallback.has(Number(amount))))throw new Error('Support plan is not active at checkout');
 const planId=match?String(match.plan_id):'mediax-legacy-'+amount;
 const days=match?Number(match.duration_days):365;
 if(!Number.isSafeInteger(days)||days<0||days>36500)throw new Error('Invalid plan duration');
 await db.execute({
   sql:"INSERT OR IGNORE INTO payping_order_plan_snapshots_v2(environment,order_number,bot_id,plan_id,duration_days,created_at) VALUES(?,?,?,?,?,?)",
   args:[env,order,'mediax',planId,days,new Date().toISOString()],
 });
 return {planId,durationDays:days};
}
export function supportExpiryFromSnapshot(paidAt,rawDays){
 const base=new Date(paidAt);
 if(!Number.isFinite(base.getTime()))return null;
 if(rawDays===null||rawDays===undefined)return null; // preserves legacy logic
 const days=Number(rawDays);
 if(!Number.isInteger(days)||days<0||days>36500)return null;
 if(days===0)return new Date('9999-12-31T23:59:59.000Z');
 return new Date(base.getTime()+days*86400000);
}
