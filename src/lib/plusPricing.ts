export const INTRO_COUPON_ID = 'plurilog_intro_9usd_3months_v1';
export const INTRO_TERMS = 'For your first 3 months, then $19/month. USD. Cancel anytime.';

export interface PlusOffer {
  amount: number | null;
  label: string;
  terms: string;
  canSubscribe: boolean;
}
