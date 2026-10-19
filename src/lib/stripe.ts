import Stripe from 'stripe';
import { isSandboxBilling } from './billingEnvironment';

if (isSandboxBilling() && !/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY || '')) {
  throw new Error('Sandbox billing requires a test Stripe key.');
}


export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-08-26.dahlia',
});
