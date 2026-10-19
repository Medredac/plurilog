import { isBillingPreview } from './paidEntry';

// Test billing must never use production balances or identifiers.
export function isSandboxBilling() {
  if (process.env.STRIPE_BILLING_MODE !== 'sandbox') return false;
  if (!isBillingPreview()) throw new Error('Sandbox billing is restricted to the billing preview.');
  return true;
}
export const billingProfileTable = () => isSandboxBilling() ? 'stripe_sandbox_profiles' : 'profiles';
export const balanceRpc = () => isSandboxBilling() ? 'get_my_sandbox_balance' : 'get_my_balance';
export const spendRpc = () => isSandboxBilling() ? 'spend_sandbox_credits' : 'spend_credits';
