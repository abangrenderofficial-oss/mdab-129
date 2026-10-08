import healthHandler from '../handlers/health.js';
import payPingHomePage from '../handlers/payping-home-pwa.js';
import payPingBotsPage from '../handlers/payping-bots-pwa.js';
import payPingBotDetailPage from '../handlers/payping-bot-detail-pwa.js';
import payPingAddBotPage from '../handlers/payping-add-bot-pwa.js';
import payPingBotAdminHandler from '../handlers/payping-bot-admin.js';
import telegramHandler from '../handlers/telegram.js';
import setupHandler from '../handlers/setup.js';
import setupWebhookHandler from '../handlers/setup-webhook.js';
import mediaHandler from '../handlers/media.js';
import diagnosticHandler from '../handlers/diagnostic.js';
import statusDiagnosticHandler from '../handlers/status-diagnostic.js';
import bayarcashHandler from '../handlers/bayarcash.js';
import supportReturnHandler from '../handlers/support-return.js';
import supportCheckoutHandler from '../handlers/support-checkout.js';
import premiumHqSuccessHandler from '../handlers/premium-hq-success.js';
import contentBridgeConnectHandler from '../handlers/content-bridge-connect.js';
import contentBridgeVerifyHandler from '../handlers/content-bridge-verify.js';
import paymentPushHandler from '../handlers/payment-push.js';
import payPingDataHandler from '../handlers/payping-data.js';
import payPingAuthHandler from '../handlers/payping-auth.js';
import payPingLoginPage from '../handlers/payping-login-pwa.js';
import payPingRegisterPage from '../handlers/payping-register-pwa.js';
import payPingSettingsHandler from '../handlers/payping-settings.js';
import payPingNotificationsPage from '../handlers/payping-notifications-pwa.js';
import payPingSettingsPage from '../handlers/payping-settings-pwa.js';
import payPingTransactionsPage from '../handlers/payping-transactions-pwa.js';
import payPingTransactionDetailPage from '../handlers/payping-transaction-detail-pwa.js';
import payPingAnalyticsPage from '../handlers/payping-analytics-pwa.js';
import affiliateWebHandler from '../handlers/affiliate-web.js';
import affiliateAdminHandler from '../handlers/affiliate-admin.js';
import affiliateAdminPageHandler from '../handlers/affiliate-admin-pwa.js';
import affiliateAdminDetailPageHandler from '../handlers/affiliate-admin-detail-pwa.js';
import affiliatePwaPageHandler from '../handlers/affiliate-pwa.js';
import heavyLimitHandler from '../handlers/heavy-limit.js';
import {
  paymentPwaPageHandler,
  paymentPwaManifestHandler,
  paymentPwaServiceWorkerHandler,
  paymentPwaIconHandler,
} from '../handlers/payment-pwa.js';

const routes = new Map([
  ['health', healthHandler],
  ['telegram', telegramHandler],
  ['setup', setupHandler],
  ['setup-webhook', setupWebhookHandler],
  ['media', mediaHandler],
  ['diagnostic', diagnosticHandler],
  ['status-diagnostic', statusDiagnosticHandler],
  ['bayarcash', bayarcashHandler],
  ['support-return', supportReturnHandler],
  ['support-checkout', supportCheckoutHandler],
  ['premium-hq-success', premiumHqSuccessHandler],
  ['content-bridge-connect', contentBridgeConnectHandler],
  ['content-bridge-verify', contentBridgeVerifyHandler],
  ['payment-push', paymentPushHandler],
  ['payping-data', payPingDataHandler],
  ['payping-auth', payPingAuthHandler],
  ['payping-login-page', payPingLoginPage],
  ['payping-register-page', payPingRegisterPage],
  ['payping-settings', payPingSettingsHandler],
  ['payping-notifications-page', payPingNotificationsPage],
  ['payping-settings-page', payPingSettingsPage],
  ['payping-transactions-page', payPingTransactionsPage],
  ['payping-transaction-detail-page', payPingTransactionDetailPage],
  ['payping-analytics-page', payPingAnalyticsPage],
  ['affiliate-web', affiliateWebHandler],
  ['affiliate-admin', affiliateAdminHandler],
  ['affiliate-admin-page', affiliateAdminPageHandler],
  ['affiliate-admin-detail-page', affiliateAdminDetailPageHandler],
  ['affiliate-pwa-page', affiliatePwaPageHandler],
  ['heavy-limit', heavyLimitHandler],
  ['payping-bots-page', payPingBotsPage],
  ['payping-bot-detail-page', payPingBotDetailPage],
  ['payping-add-bot-page', payPingAddBotPage],
  ['payping-bot-admin', payPingBotAdminHandler],
  ['payment-pwa-page', payPingHomePage],
  ['payment-pwa-manifest', paymentPwaManifestHandler],
  ['payment-pwa-sw', paymentPwaServiceWorkerHandler],
  ['payment-pwa-icon', paymentPwaIconHandler],
]);

function routeKey(req) {
  const value = Array.isArray(req?.query?.route) ? req.query.route[0] : req?.query?.route;
  if (value) return String(value);
  try { return new URL(req.url || '', 'https://runtime.local').searchParams.get('route') || ''; }
  catch { return ''; }
}

export default async function handler(req, res) {
  const route = routeKey(req);
  if (route === 'root') {
    return res.status(200).json({
      ok: true,
      service: 'telegram-social-downloader',
      runtime: 'vercel-node',
      architecture: 'single-router-v1',
    });
  }
  const target = routes.get(route);
  if (!target) return res.status(404).json({ ok: false, error: 'route_not_found' });
  return target(req, res);
}
