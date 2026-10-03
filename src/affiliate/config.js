function numberEnv(name, fallback) {
  const raw = String(process.env[name] ?? '').trim();
  const value = raw === '' ? fallback : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function affiliateCommissionPercent() {
  return Math.min(100, Math.max(0, numberEnv('AFFILIATE_COMMISSION_PERCENT', 20)));
}

export function affiliateCommissionBps() {
  return Math.round(affiliateCommissionPercent() * 100);
}

export function affiliateHoldDays() {
  return Math.min(365, Math.max(0, Math.floor(numberEnv('AFFILIATE_HOLD_DAYS', 7))));
}

export function affiliateMinimumWithdrawalCents() {
  const ringgit = Math.min(1000000, Math.max(1, numberEnv('AFFILIATE_MIN_WITHDRAW_RM', 20)));
  return Math.round(ringgit * 100);
}
