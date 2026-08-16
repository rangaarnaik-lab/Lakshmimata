/** Subscription plan catalog — landing, paywall, and checkout share this. */
export const SUBSCRIPTION_PLANS = [
  { cycle: 'monthly',   label: 'Monthly',   price: 699,  perMonth: 699, badge: null,     days: 30 },
  { cycle: 'quarterly', label: 'Quarterly', price: 1500, perMonth: 500, badge: 'Save 28%', days: 90 },
  { cycle: 'yearly',    label: 'Yearly',    price: 5000, perMonth: 417, badge: 'Save 40%', days: 365 },
]

export const PLAN_FEATURES = [
  'Live RS ratings across 2,300+ NSE stocks',
  'Volume signals — PP, HY/HT, IBV, Bull Snort, Vol→EMA',
  'Patterns, squeezes, Stage 2 & breakouts',
  'Market breadth, FII–DII, sector rotation',
  'Results, PPT & concall AI digests',
  'Watchlists, portfolio import & alerts',
]

export function periodEndForCycle(cycle, from = new Date()) {
  const plan = SUBSCRIPTION_PLANS.find(p => p.cycle === cycle) || SUBSCRIPTION_PLANS[2]
  const end = new Date(from)
  end.setDate(end.getDate() + (plan.days || 30))
  return end
}
