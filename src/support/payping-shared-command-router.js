import {sendMessage} from '../telegram.js';
import {recordMediaXRecipient} from './payping-reminder-registry.js';
import {isResetAdmin} from '../recovery.js';
import {isDailyForceSupportEnabled,setDailyForceSupportEnabled} from './daily-force.js';
import {refreshSupportMonitorForMode} from './monitor-hooks.js';
import {
  isPayPingSharedConfigEnabled,refreshSupportAmounts,reportPayPingSync,
  setMediaXFreeAccessMode,setMediaXFreeChannelAccessMode,
} from './payping-shared-config.js';

export async function syncSharedConfigForUpdate(userId='',chatType=''){
  if(!isPayPingSharedConfigEnabled())return;
  void recordMediaXRecipient(userId,chatType).catch(e=>console.warn('[payping-reminders] recipient sync failed:',e.message));
  try{await refreshSupportAmounts();await reportPayPingSync()}
  catch(error){console.warn('[payping-shared] sync refresh failed:',error?.message)}
}

const COMMANDS=new Set([
  '/forcesupport','/freesupportchannel','/normalsupport',
  '/supportnormal','/stopforcesupport',
  '/forcesupportdaily','/stopforcesupportdaily',
  '/donatesupport','/stopdonatesupport','/stopnormalsupport','/stopsupportnormal',
]);

/** Canonical shared mode:
 * /forcesupport       -> Force Support seven days/week, ONE completed media use.
 * /freesupportchannel -> Free + Channel, ONE completed media use, gate second source.
 * /normalsupport      -> Free with NO support/channel gate.
 * Old daily/Friday commands do not change any rule.
 */
export async function routeUnifiedForceCommand(message,command){
  if(!COMMANDS.has(command))return null;
  const userId=message?.from?.id;
  if(!isResetAdmin(userId)||message?.chat?.type!=='private'){
    if(message?.chat?.type==='private')await sendMessage(message.chat.id,'❌ Command Access Control hanya untuk admin.').catch(()=>{});
    return {ok:true,ignored:'owner_private_only'};
  }
  const chatId=message.chat.id;
  if(['/forcesupportdaily','/stopforcesupportdaily'].includes(command)){
    await sendMessage(chatId,'ℹ️ Command Daily Force dah ditamatkan. Guna /forcesupport, /freesupportchannel atau /normalsupport.').catch(()=>{});
    return {ok:true,deprecated:true};
  }
  if(['/donatesupport','/stopdonatesupport','/stopnormalsupport','/stopsupportnormal'].includes(command)){
    await sendMessage(chatId,'ℹ️ Friday-only mode dah digantikan tiga mode PayPing: /forcesupport, /freesupportchannel, /normalsupport.').catch(()=>{});
    return {ok:true,deprecated:true};
  }
  if(!isPayPingSharedConfigEnabled()){
    await sendMessage(chatId,'⚠️ Sync PayPing belum diaktifkan pada bot. Command tidak diubah supaya tiada lock bercanggah. Semak PAYPING_SHARED_CONFIG_ENABLED di hosting bot.').catch(()=>{});
    return {ok:true,changed:false,reason:'shared_config_disabled'};
  }
  // Telegram mode commands are retained but may no longer mutate PayPing policy.
  await sendMessage(chatId,'🔐 Access Control MediaX dikawal melalui PayPing Aurora → Bots → MediaX → Access Control. Command tidak mengubah mode.').catch(()=>{});
  return {ok:true,changed:false,reason:'payping_authoritative'};
}
