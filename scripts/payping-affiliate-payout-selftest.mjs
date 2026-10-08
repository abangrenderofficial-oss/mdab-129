import { readFile } from 'node:fs/promises';

const [store, webApi, userPage, adminPage, adminDetailPage, telegramAffiliate] = await Promise.all([
  readFile('src/affiliate/store.js', 'utf8'),
  readFile('handlers/affiliate-web.js', 'utf8'),
  readFile('handlers/affiliate-pwa.js', 'utf8'),
  readFile('handlers/affiliate-admin-pwa.js', 'utf8'),
  readFile('handlers/affiliate-admin-detail-pwa.js', 'utf8'),
  readFile('src/features/affiliate.js', 'utf8'),
]);

const must=(src,marker,label)=>{if(!src.includes(marker))throw new Error(`${label} missing: ${marker}`)};

must(store,"createCipheriv('aes-256-gcm'",'AES payout encryption');
must(store,"createDecipheriv(", 'AES payout decryption');
must(store,'affiliate_payout_profiles','payout profile table');
must(store,'details_ciphertext','ciphertext storage');
must(store,'AFFILIATE_PAYOUT_ENCRYPTION_KEY','dedicated payout key support');
must(store,'SETUP_SECRET','cross-runtime key fallback');
must(store,"method === 'DUITNOW'",'DuitNow payout');
must(store,"method === 'BANK'",'bank payout');
must(store,'export async function saveAffiliatePayoutProfile','save payout profile');
must(store,'export async function getAffiliatePayoutProfile','get payout profile');
must(store,"reason: 'payout_profile_required'",'withdrawal payout requirement');
must(store,'decryptPayoutDetails(row.details_ciphertext)','owner payout decryption');

must(webApi,"action === 'save_payout'",'web payout save action');
must(webApi,'getAffiliatePayoutProfile','web payout read');
must(webApi,'saveAffiliatePayoutProfile','web payout save');
must(webApi,'payoutProfile?.configured === true','web withdrawal payout guard');

must(userPage,'Payout Method','user payout UI');
must(userPage,'DuitNow','DuitNow UI');
must(userPage,'Bank Transfer','bank UI');
must(userPage,"action:'save_payout'",'payout save request');
must(userPage,'Setup payout first','withdraw guard UI');

must(adminDetailPage,'payoutHtml(d.payoutProfile)','owner payout rendering');
must(adminDetailPage,'DuitNow','owner DuitNow detail rendering');
must(adminDetailPage,'accountNumber','owner bank detail rendering');

must(telegramAffiliate,'sendAffiliateWebEntry','Telegram PayPing affiliate entry');
must(telegramAffiliate,'Open PayPing Withdrawal','Telegram withdrawal opens PayPing');

if(/details_ciphertext[^\n]*console|console[^\n]*details_ciphertext/i.test(store+webApi)){
  throw new Error('Encrypted payout payload must not be logged.');
}

console.log('PAYPING_AFFILIATE_PAYOUT_SELFTEST_OK');
