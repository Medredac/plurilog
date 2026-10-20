import { isBillingPreview } from './paidEntry';

// Stripe sandbox credentials stay preview-only; balances use the existing tables.
export function isSandboxBilling() {
  if (process.env.STRIPE_BILLING_MODE !== 'sandbox') return false;
  if (!isBillingPreview()) throw new Error('Sandbox billing is restricted to the billing preview.');
  return true;
}
export const billingProfileTable = () => { isSandboxBilling(); return 'profiles'; };
export const balanceRpc = () => { isSandboxBilling(); return 'get_my_balance'; };
export const spendRpc = () => { isSandboxBilling(); return 'spend_credits'; };
