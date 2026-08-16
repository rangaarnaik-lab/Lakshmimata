import React, { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { SUBSCRIPTION_PLANS, PLAN_FEATURES, periodEndForCycle } from '../lib/plans'
import { loadRazorpayScript, paymentsEnabled, razorpayKeyId } from '../lib/razorpay'

/**
 * Checkout / paywall — plan picker + Razorpay when VITE_RAZORPAY_KEY_ID is set.
 * Without a key, shows plans and a contact path (payments not live yet).
 */
export default function PaymentPage({
  session,
  reason = 'upgrade',
  onPaid,
  onLogout,
  onClose,
  theme,
}) {
  const C = theme || {
    bg: '#0b0f14', card: '#121821', border: '#1e2a3a', text: '#e8eef7',
    muted: '#8b96a8', accent: '#3d9cf0', green: '#22c55e', red: '#ef4444',
    purple: '#8b5cf6', yellow: '#eab308',
  }
  const [selectedCycle, setSelectedCycle] = useState('yearly')
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const live = paymentsEnabled()
  const plan = useMemo(
    () => SUBSCRIPTION_PLANS.find(p => p.cycle === selectedCycle) || SUBSCRIPTION_PLANS[2],
    [selectedCycle],
  )

  const messages = {
    trial_expired: {
      title: 'Your free trial has ended',
      body: 'Choose a plan to keep your RS terminal, filings AI, and watchlists.',
    },
    cancelled: {
      title: 'Subscription cancelled',
      body: 'Resubscribe below to restore full access.',
    },
    past_due: {
      title: 'Payment issue',
      body: 'Update payment below to restore access. If this keeps failing, contact us.',
    },
    upgrade: {
      title: 'Choose your plan',
      body: 'Unlock continuous access after the trial — cancel anytime from Settings once renewals are live.',
    },
  }
  const msg = messages[reason] || messages.upgrade

  const activateSubscription = async (paymentId, cycle) => {
    const userId = session?.user?.id
    if (!userId) throw new Error('Not signed in')
    const periodEnd = periodEndForCycle(cycle)
    const row = {
      user_id: userId,
      status: 'active',
      plan_cycle: cycle,
      current_period_end: periodEnd.toISOString(),
      razorpay_payment_id: paymentId || null,
      updated_at: new Date().toISOString(),
    }
    const { error: upErr } = await supabase.from('subscriptions').upsert(row, { onConflict: 'user_id' })
    if (upErr) throw upErr
    try {
      await supabase.from('payment_orders').insert({
        user_id: userId,
        plan_cycle: cycle,
        amount_inr: plan.price,
        currency: 'INR',
        razorpay_payment_id: paymentId || null,
        status: 'paid',
      })
    } catch (_) { /* table may not exist yet — subscription row is enough */ }
    return row
  }

  const startCheckout = async () => {
    setError('')
    if (!session?.user) {
      setError('Please sign in to pay.')
      return
    }
    if (!live) {
      setError('Online payments are not enabled yet. Add VITE_RAZORPAY_KEY_ID, or email us to activate your plan.')
      return
    }
    setPaying(true)
    try {
      const ok = await loadRazorpayScript()
      if (!ok || !window.Razorpay) throw new Error('Could not load Razorpay Checkout')

      const options = {
        key: razorpayKeyId(),
        amount: plan.price * 100,
        currency: 'INR',
        name: 'Lakshmimata',
        description: `${plan.label} subscription`,
        image: undefined,
        prefill: {
          email: session.user.email || '',
          name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || '',
        },
        notes: {
          user_id: session.user.id,
          plan_cycle: plan.cycle,
        },
        theme: { color: '#3d9cf0' },
        handler: async (response) => {
          try {
            const row = await activateSubscription(response.razorpay_payment_id, plan.cycle)
            setDone(true)
            onPaid?.(row)
          } catch (e) {
            setError(e?.message || 'Payment received but activation failed — contact support with your payment id.')
          } finally {
            setPaying(false)
          }
        },
        modal: {
          ondismiss: () => setPaying(false),
        },
      }
      const rzp = new window.Razorpay(options)
      rzp.on('payment.failed', (resp) => {
        setPaying(false)
        setError(resp?.error?.description || 'Payment failed. Please try again.')
      })
      rzp.open()
    } catch (e) {
      setPaying(false)
      setError(e?.message || 'Checkout failed')
    }
  }

  if (done) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 24, color: C.text, fontFamily: "'Inter',sans-serif" }}>
        <div style={{ width: '100%', maxWidth: 420, textAlign: 'center',
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '36px 28px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
          <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 8 }}>You&apos;re in</div>
          <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.6, marginBottom: 24 }}>
            {plan.label} plan is active. Welcome back to the terminal.
          </div>
          <button type="button" onClick={() => onPaid?.({ status: 'active', plan_cycle: plan.cycle })}
            style={{ width: '100%', padding: '12px 18px', borderRadius: 10, border: 'none',
              background: C.accent, color: '#000', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
            Continue to Lakshmimata
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text,
      fontFamily: "'Inter',sans-serif", padding: '28px 20px 48px' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12,
                background: `linear-gradient(135deg,${C.accent},${C.purple})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 900, color: '#000', fontSize: 18 }}>L</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Lakshmimata</div>
            </div>
            <h1 style={{ fontWeight: 800, fontSize: 'clamp(22px,3vw,28px)', margin: '0 0 8px' }}>{msg.title}</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted, lineHeight: 1.6, maxWidth: 520 }}>{msg.body}</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {onClose && (
              <button type="button" onClick={onClose}
                style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
                  background: 'transparent', color: C.muted, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Back
              </button>
            )}
            {onLogout && (
              <button type="button" onClick={onLogout}
                style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
                  background: 'transparent', color: C.muted, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Sign out
              </button>
            )}
          </div>
        </div>

        <div className="pay-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,0.9fr)',
          gap: 20, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {SUBSCRIPTION_PLANS.map(p => {
              const on = selectedCycle === p.cycle
              return (
                <button key={p.cycle} type="button" onClick={() => setSelectedCycle(p.cycle)}
                  style={{ textAlign: 'left', cursor: 'pointer',
                    border: `2px solid ${on ? C.accent : C.border}`,
                    borderRadius: 14, padding: '16px 18px',
                    background: on ? C.accent + '14' : C.card,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontWeight: 800, fontSize: 15, color: C.text }}>{p.label}</span>
                      {p.badge && (
                        <span style={{ fontSize: 10, fontWeight: 800, color: C.green,
                          background: C.green + '22', padding: '2px 8px', borderRadius: 99 }}>{p.badge}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: C.muted }}>₹{p.perMonth}/mo equivalent · billed {p.label.toLowerCase()}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 900, fontSize: 20, color: C.text }}>₹{p.price.toLocaleString('en-IN')}</div>
                    <div style={{ fontSize: 10, color: C.muted }}>{p.days} days</div>
                  </div>
                </button>
              )
            })}
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 22,
            position: 'sticky', top: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '0.08em',
              textTransform: 'uppercase', marginBottom: 10 }}>Order summary</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{plan.label} plan</span>
              <span style={{ fontWeight: 900, fontSize: 22 }}>₹{plan.price.toLocaleString('en-IN')}</span>
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>
              Access through {periodEndForCycle(plan.cycle).toLocaleDateString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric',
              })}
            </div>

            <div style={{ fontSize: 12, color: C.muted, marginBottom: 14, lineHeight: 1.55 }}>
              {PLAN_FEATURES.map(f => (
                <div key={f} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <span style={{ color: C.green }}>✓</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>

            {error && (
              <div style={{ background: C.red + '18', border: `1px solid ${C.red}55`, color: C.red,
                borderRadius: 8, padding: '10px 12px', fontSize: 12, marginBottom: 12, lineHeight: 1.45 }}>
                {error}
              </div>
            )}

            <button type="button" onClick={startCheckout} disabled={paying}
              style={{ width: '100%', padding: '13px 16px', borderRadius: 10, border: 'none',
                background: paying ? C.border : `linear-gradient(135deg,${C.accent},${C.accent}cc)`,
                color: paying ? C.muted : '#000', fontWeight: 800, fontSize: 14,
                cursor: paying ? 'not-allowed' : 'pointer', marginBottom: 10 }}>
              {paying ? 'Opening checkout…' : live ? `Pay ₹${plan.price.toLocaleString('en-IN')}` : 'Pay (Razorpay setup needed)'}
            </button>

            {!live && (
              <div style={{ fontSize: 11, color: C.yellow, lineHeight: 1.5, marginBottom: 10,
                background: C.yellow + '14', border: `1px solid ${C.yellow}44`, borderRadius: 8, padding: '10px 12px' }}>
                Razorpay key not configured. Set <code style={{ fontSize: 10 }}>VITE_RAZORPAY_KEY_ID</code> in
                the frontend env, redeploy, then checkout opens here. Until then, message us to activate a plan manually.
              </div>
            )}

            <div style={{ fontSize: 10, color: C.muted, lineHeight: 1.5, textAlign: 'center' }}>
              UPI · Cards · Netbanking via Razorpay · Prices in INR · For education only — not investment advice
            </div>
          </div>
        </div>

        <style>{`
          @media (max-width: 760px) {
            .pay-grid { grid-template-columns: 1fr !important; }
          }
        `}</style>
      </div>
    </div>
  )
}
