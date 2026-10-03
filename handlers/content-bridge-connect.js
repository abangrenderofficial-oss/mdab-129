import { getQuoteFilterGroup } from '../src/support/quote-filter.js';
import {
  deliverApprovedBacklog,
  isContentBridgeConfigured,
  setContentBridgeGroup,
} from '../src/support/content-bridge.js';

function json(res, status, body) {
  return res.status(status).json(body);
}

function authorized(req) {
  const expected = String(process.env.CONTENT_BRIDGE_SECRET || '').trim();
  if (!expected) return false;
  return String(req.headers['x-content-bridge-secret'] || '') === expected;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  }
  if (!authorized(req)) return json(res, 403, { ok: false, error: 'invalid_bridge_secret' });
  if (!isContentBridgeConfigured()) {
    return json(res, 503, { ok: false, error: 'content_bridge_not_configured' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const groupId = String(body.filter_group_id || '').trim();
  const title = String(body.filter_group_title || '').trim();
  if (!/^-?\d+$/.test(groupId)) {
    return json(res, 422, { ok: false, error: 'invalid_filter_group_id' });
  }

  try {
    const quoteGroup = await getQuoteFilterGroup();
    if (!quoteGroup?.groupId) {
      return json(res, 409, { ok: false, error: 'quote_filter_not_connected' });
    }
    if (String(quoteGroup.groupId) !== groupId) {
      return json(res, 409, {
        ok: false,
        error: 'content_group_must_match_quote_filter_group',
      });
    }

    await setContentBridgeGroup(groupId, title || quoteGroup.title || '');
    const backlog = await deliverApprovedBacklog(100);
    return json(res, 200, {
      ok: true,
      group_id: groupId,
      backlog_checked: backlog.checked,
      backlog_delivered: backlog.delivered,
    });
  } catch (error) {
    console.error('[content-bridge/connect] failed:', error?.message);
    return json(res, 500, { ok: false, error: error?.message || 'internal_error' });
  }
}
