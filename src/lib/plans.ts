export type AccountPlan = 'free' | 'paid' | 'weekly_paid';
export function isPlusPlan(plan: unknown): plan is 'paid' | 'weekly_paid' {
  return plan === 'paid' || plan === 'weekly_paid';
}
export function accountPlan(plan: unknown): AccountPlan {
  return isPlusPlan(plan) ? plan : 'free';
}
