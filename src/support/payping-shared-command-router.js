import {sendMessage} from '../telegram.js';
import {isResetAdmin} from '../recovery.js';
import {handleDailyForceSupportCommand,handleStopDailyForceSupportCommand} from './daily-force.js';
import {refreshSupportMonitorForMode} from './monitor-hooks.js';
import {isPayPingSharedConfigEnabled,refreshSupportAmounts,reportPayPingSync} from './payping-shared-config.js';

export async function syncSharedConfigForUpdate(){
  if(!isPayPingSharedConfigEnabled())return;
  try{await refreshSupportAmounts();await reportPayPingSync()}
  catch(error){console.warn('[payping-shared] sync refresh failed:',error?.message)}
}
export async function routeUnifiedForceCommand(message,command){
  if(!isPayPingSharedConfigEnabled())return null;
  if(command==='/forcesupport'||command==='/forcesupportdaily'){
    await handleDailyForceSupportCommand(message);
    if(isResetAdmin(message?.from?.id))await refreshSupportMonitorForMode('ON');
    return {ok:true,force_support:'ON'};
  }
  if(['/normalsupport','/supportnormal','/stopforcesupport','/stopforcesupportdaily'].includes(command)){
    await handleStopDailyForceSupportCommand(message);
    if(isResetAdmin(message?.from?.id))await refreshSupportMonitorForMode('OFF');
    return {ok:true,force_support:'OFF'};
  }
  if(['/donatesupport','/stopdonatesupport','/stopnormalsupport','/stopsupportnormal'].includes(command)){
    if(isResetAdmin(message?.from?.id)&&message?.chat?.type==='private')
      await sendMessage(message.chat.id,'ℹ️ Friday-only mode diganti Force Support setiap hari. Guna /forcesupport atau /normalsupport.');
    return {ok:true,legacy_command:true};
  }
  return null;
}
