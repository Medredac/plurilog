// Only this isolated branch uses simulated billing. Never follows a URL parameter.
export function isBillingPreview() {
  return process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === 'preview/weekly-paid-entry';
}
export function paidEntryCutoff() {
  return process.env.PAID_ENTRY_STARTS_AT || (isBillingPreview() ? '2026-10-19T17:46:29.236598+00:00' : '');
}
export function requiresPaidEntry(createdAt: string | undefined, plan: string, cutoff = paidEntryCutoff()) {
  if (!cutoff || plan === 'paid') return false;
  const start = Date.parse(cutoff);
  const created = Date.parse(createdAt || '');
  // Never restrict existing users because a timestamp is missing or invalid.
  return Number.isFinite(start) && Number.isFinite(created) && created >= start;
}
