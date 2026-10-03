import http from 'node:http';
import { URL } from 'node:url';

import healthHandler from './handlers/health.js';
import payPingHomePage from './handlers/payping-home-pwa.js';
import telegramHandler from './handlers/telegram.js';
import setupHandler from './handlers/setup.js';
import setupWebhookHandler from './handlers/setup-webhook.js';
import mediaHandler from './handlers/media.js';
import diagnosticHandler from './handlers/diagnostic.js';
import statusDiagnosticHandler from './handlers/status-diagnostic.js';
import bayarcashHandler from './handlers/bayarcash.js';
import supportReturnHandler from './handlers/support-return.js';
import premiumHqSuccessHandler from './handlers/premium-hq-success.js';
import contentBridgeConnectHandler from './handlers/content-bridge-connect.js';
import contentBridgeVerifyHandler from './handlers/content-bridge-verify.js';
import paymentPushHandler from './handlers/payment-push.js';
import payPingDataHandler from './handlers/payping-data.js';
import payPingAuthHandler from './handlers/payping-auth.js';
import payPingLoginPage from './handlers/payping-login-pwa.js';
import payPingRegisterPage from './handlers/payping-register-pwa.js';
import payPingSettingsHandler from './handlers/payping-settings.js';
import payPingNotificationsPage from './handlers/payping-notifications-pwa.js';
import payPingSettingsPage from './handlers/payping-settings-pwa.js';
import payPingTransactionsPage from './handlers/payping-transactions-pwa.js';
import payPingTransactionDetailPage from './handlers/payping-transaction-detail-pwa.js';
import payPingAnalyticsPage from './handlers/payping-analytics-pwa.js';
import affiliateWebHandler from './handlers/affiliate-web.js';
import affiliateAdminHandler from './handlers/affiliate-admin.js';
import affiliateAdminPageHandler from './handlers/affiliate-admin-pwa.js';
import affiliatePwaPageHandler from './handlers/affiliate-pwa.js';
import {
  paymentPwaPageHandler,
  paymentPwaManifestHandler,
  paymentPwaServiceWorkerHandler,
  paymentPwaIconHandler,
} from './handlers/payment-pwa.js';
import {
  getBayarcashPortalDiagnostic,
  isBayarcashConfigured,
  isBayarcashSandbox,
} from './src/payments/bayarcash.js';
import { startSupportPromotionScheduler } from './src/support/promotion.js';
import { deliverApprovedBacklog, isContentBridgeConfigured } from './src/support/content-bridge.js';
import { refreshSupportMonitorMessage } from './src/support/monitor-publisher.js';
import { getDailyForceRuntimeState, repairDailyForceCurrentCycleUsers } from './src/support/daily-force.js';

const MAX_BODY_BYTES = 5 * 1024 * 1024;

const routes = new Map([
  ['/api/health', healthHandler],
  ['/api/telegram', telegramHandler],
  ['/api/setup', setupHandler],
  ['/api/setup-webhook', setupWebhookHandler],
  ['/api/media', mediaHandler],
  ['/api/diagnostic', diagnosticHandler],
  ['/api/status-diagnostic', statusDiagnosticHandler],
  ['/api/bayarcash', bayarcashHandler],
  ['/api/support-return', supportReturnHandler],
  ['/api/premium-hq-success', premiumHqSuccessHandler],
  ['/api/content-bridge/connect', contentBridgeConnectHandler],
  ['/api/content-bridge/verify', contentBridgeVerifyHandler],
  ['/api/payment-push', paymentPushHandler],
  ['/api/payping-data', payPingDataHandler],
  ['/api/payping-auth', payPingAuthHandler],
  ['/api/payping-settings', payPingSettingsHandler],
  ['/ar-payment/login', payPingLoginPage],
  ['/ar-payment/login/', payPingLoginPage],
  ['/ar-payment/register', payPingRegisterPage],
  ['/ar-payment/register/', payPingRegisterPage],
  ['/ar-payment/notifications', payPingNotificationsPage],
  ['/ar-payment/notifications/', payPingNotificationsPage],
  ['/ar-payment/settings', payPingSettingsPage],
  ['/ar-payment/settings/', payPingSettingsPage],
  ['/ar-payment/transactions', payPingTransactionsPage],
  ['/ar-payment/transactions/', payPingTransactionsPage],
  ['/ar-payment/transaction', payPingTransactionDetailPage],
  ['/ar-payment/transaction/', payPingTransactionDetailPage],
  ['/ar-payment/analytics', payPingAnalyticsPage],
  ['/ar-payment/analytics/', payPingAnalyticsPage],
  ['/api/affiliate-web', affiliateWebHandler],
  ['/api/affiliate-admin', affiliateAdminHandler],
  ['/ar-payment/affiliate/admin', affiliateAdminPageHandler],
  ['/ar-payment/affiliate/admin/', affiliateAdminPageHandler],
  ['/ar-payment/affiliate', affiliatePwaPageHandler],
  ['/ar-payment/affiliate/', affiliatePwaPageHandler],
  ['/ar-payment', payPingHomePage],
  ['/ar-payment/', payPingHomePage],
  ['/ar-payment/manifest.webmanifest', paymentPwaManifestHandler],
  ['/ar-payment/payping.webmanifest', paymentPwaManifestHandler],
  ['/ar-payment/payping-v4.webmanifest', paymentPwaManifestHandler],
  ['/ar-payment/sw.js', paymentPwaServiceWorkerHandler],
  ['/ar-payment/icon.svg', paymentPwaIconHandler],
  ['/ar-payment/payping-icon.svg', paymentPwaIconHandler],
  ['/ar-payment/payping-icon-v4.svg', paymentPwaIconHandler],
]);

function addResponseHelpers(res) {
  res.status = function status(code) {
    this.statusCode = Number(code) || 200;
    return this;
  };

  res.json = function json(value) {
    if (!this.headersSent && !this.hasHeader('Content-Type')) {
      this.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    this.end(JSON.stringify(value));
    return this;
  };

  res.send = function send(value = '') {
    if (value !== null && typeof value === 'object' && !Buffer.isBuffer(value)) {
      return this.json(value);
    }
    this.end(value ?? '');
    return this;
  };
}

function parseQuery(url) {
  const query = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (Object.prototype.hasOwnProperty.call(query, key)) {
      query[key] = Array.isArray(query[key]) ? [...query[key], value] : [query[key], value];
    } else {
      query[key] = value;
    }
  }
  return query;
}

async function parseBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('request_body_too_large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();

  if (type === 'application/json' || type.endsWith('+json')) {
    return raw ? JSON.parse(raw) : undefined;
  }

  if (type === 'application/x-www-form-urlencoded') {
    const out = {};
    const params = new URLSearchParams(raw);
    for (const [key, value] of params.entries()) {
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        out[key] = Array.isArray(out[key]) ? [...out[key], value] : [out[key], value];
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  return raw;
}

const server = http.createServer(async (req, res) => {
  addResponseHelpers(res);

  try {
    const host = req.headers.host || `127.0.0.1:${process.env.PORT || 3000}`;
    const url = new URL(req.url || '/', `http://${host}`);

    req.query = parseQuery(url);
    req.body = await parseBody(req);

    if (url.pathname === '/') {
      return res.status(200).json({
        ok: true,
        service: 'telegram-social-downloader',
        runtime: 'railway-node',
        architecture: 'isolated-features-v1',
      });
    }

    const handler = routes.get(url.pathname);
    if (!handler) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }

    await handler(req, res);
    if (!res.writableEnded) res.end();
  } catch (error) {
    console.error('Railway server request failed:', error);
    if (res.headersSent) return res.end();
    return res.status(error?.statusCode || 500).json({
      ok: false,
      error: error?.message || 'internal_error',
    });
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => {
  console.log(`Downloader bot listening on 0.0.0.0:${port}`);
  console.log('[bayarcash] runtime', {
    environment: isBayarcashSandbox() ? 'sandbox' : 'production',
    configured: isBayarcashConfigured(),
  });

  startSupportPromotionScheduler();

  void getDailyForceRuntimeState()
    .then(async (state) => {
      console.log('[daily-force] startup policy initialized', {
        enabled: state.enabled,
        active: state.active,
        cycleId: state.cycleId,
        policyVersion: state.policyVersion,
        weekday: state.weekday,
      });

      if (String(process.env.DAILY_FORCE_REPAIR_USER_IDS || '').trim()) {
        const repair = await repairDailyForceCurrentCycleUsers();
        console.log('[daily-force] one-time repair applied', repair);
      }
    })
    .catch((error) => {
      console.warn('[daily-force] startup policy initialization failed:', error?.message);
    });

  void refreshSupportMonitorMessage({ force: true })
    .then((result) => {
      console.log('[support-monitor] startup refresh', result);
    })
    .catch((error) => {
      console.warn('[support-monitor] startup refresh failed:', error?.message);
    });

  if (isContentBridgeConfigured()) {
    console.log('[content-bridge] retry scheduler started');
    setInterval(() => {
      void deliverApprovedBacklog(20).catch((error) => {
        console.error('[content-bridge] backlog retry failed:', error?.message);
      });
    }, 60_000).unref();
  }

  if (isBayarcashConfigured()) {
    void getBayarcashPortalDiagnostic()
      .then((diagnostic) => {
        console.log('[bayarcash] portal diagnostic OK', {
          environment: diagnostic.sandbox ? 'sandbox' : 'production',
          portal_name: diagnostic.portalName,
          active_channel_ids: diagnostic.paymentChannels.map((channel) => channel.id),
        });
      })
      .catch((error) => {
        console.error('[bayarcash] portal diagnostic FAILED', {
          code: error?.code || null,
          status: error?.status || null,
          message: error?.message || String(error),
        });
      });
  }
});
