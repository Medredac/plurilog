// Identify the isolated paid-entry preview branch. Never follows a URL parameter.
export function isBillingPreview() {
  return process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === 'preview/weekly-paid-entry';
}
export function paidEntryCutoff() {
  return process.env.PAID_ENTRY_STARTS_AT || (isBillingPreview() ? '2026-10-19T17:46:29.236598+00:00' : '');
}
// Plan labels never block a user who still has usable credits.
export function hasUsableBalance(remaining: unknown) {
  const amount = Number(remaining);
  return Number.isFinite(amount) && amount > 0;
}
