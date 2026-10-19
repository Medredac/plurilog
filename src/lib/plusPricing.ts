export const INTRO_COUPON_ID = 'plurilog_intro_9usd_3months_v1';
export const INTRO_TERMS = 'For your first 3 months, then $19/month.';

export interface PlusOffer {
  amount: number | null;
  label: string;
  terms: string;
  canSubscribe: boolean;
}

export type BillingInterval = 'week' | 'month';
export const WEEKLY_PRICE = 4.99;
export const MONTHLY_PRICE = 19;
export const INTRO_MONTHLY_PRICE = 9;
// Compare 52 weekly charges with 12 monthly charges, rounded down.
export function monthlySavingsPercent(monthly: number) {
  return Math.floor((1 - monthly * 12 / (WEEKLY_PRICE * 52)) * 100);
}
export function monthlySavingsText(monthly: number) {
  return `Save ${monthlySavingsPercent(monthly)}% vs weekly${monthly === INTRO_MONTHLY_PRICE ? ' for 3 months' : ''}`;
}
