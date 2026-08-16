/** Load Razorpay Checkout.js once. */
export function loadRazorpayScript() {
  return new Promise(resolve => {
    if (typeof window !== 'undefined' && window.Razorpay) {
      resolve(true)
      return
    }
    const existing = document.querySelector('script[data-lakshmimata-razorpay]')
    if (existing) {
      existing.addEventListener('load', () => resolve(!!window.Razorpay))
      existing.addEventListener('error', () => resolve(false))
      return
    }
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.async = true
    s.dataset.lakshmimataRazorpay = '1'
    s.onload = () => resolve(!!window.Razorpay)
    s.onerror = () => resolve(false)
    document.body.appendChild(s)
  })
}

export function razorpayKeyId() {
  return (import.meta.env.VITE_RAZORPAY_KEY_ID || '').trim()
}

export function paymentsEnabled() {
  return !!razorpayKeyId()
}
