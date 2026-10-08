import {sendMessage} from '../telegram.js';
import {isResetAdmin} from '../recovery.js';
import {isDailyForceSupportEnabled,setDailyForceSupportEnabled} from './daily-force.js';
import {refreshSupportMonitorForMode} from './monitor-hooks.js';
import {
  isPayPingSharedConfigEnabled,refreshSupportAmounts,reportPayPingSync,
  setMediaXFreeAccessMode,setMediaXFreeChannelAccessMode,
} from './payping-shared-config.js';

export async function syncSharedConfigForUpdate(){
  if(!isPayPingSharedConfigEnabled())return;
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
  try{
    let next,summary;
    if(command==='/forcesupport'){
      const previous=await isDailyForceSupportEnabled();
      const saved=await setDailyForceSupportEnabled(true,userId);
      next='force_support';
      summary='🔒 Force Support ON (7 hari seminggu). 1 penggunaan media lengkap percuma; input media baharu kali kedua barulah minta support. Cycle: '+saved.cycleId+(previous?' (kekal)':'');
    }else if(command==='/freesupportchannel'){
      await setMediaXFreeChannelAccessMode({dryRun:true}); // Fail safely BEFORE switching off the force lock.
      if(await isDailyForceSupportEnabled())await setDailyForceSupportEnabled(false,userId);
      const saved=await setMediaXFreeChannelAccessMode();
      next='free_channel';
      summary='📢 Free + Channel ON. 1 penggunaan lengkap percuma; input baharu kali kedua wajib join '+saved.channel+'.'+(saved.newCampaign?' Kempen akses baharu bermula.':' Kempen sedia ada dikekalkan.');
    }else{
      if(await isDailyForceSupportEnabled())await setDailyForceSupportEnabled(false,userId);
      await setMediaXFreeAccessMode();
      next='free';
      summary='🔓 Free ON. Semua user boleh guna tanpa lock support atau syarat channel.';
    }
    await refreshSupportMonitorForMode(next==='force_support'?'ON':'OFF').catch(error=>console.warn('[support-monitor] update failed:',error?.message));
    await reportPayPingSync().catch(()=>{});
    await sendMessage(chatId,summary);
    return {ok:true,access_mode:next};
  }catch(error){
    await sendMessage(chatId,'❌ Tak dapat tukar mode PayPing: '+String(error?.message||error).slice(0,230)).catch(()=>{});
    return {ok:false,reason:'access_mode_save_failed'};
  }
}
