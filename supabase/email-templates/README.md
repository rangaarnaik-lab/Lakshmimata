# Supabase Auth email templates (Lakshmimata)

Supabase sends auth mail from its default templates until you replace them
in the dashboard. App code cannot change those emails by itself.

## Paste these in (2 minutes)

1. Open **Supabase Dashboard** → your project  
2. **Authentication** → **Email Templates** → **Reset password**  
3. **Subject** → set exactly: `Lakshmimata password reset`  
4. **Body** → paste HTML from [`recovery.html`](./recovery.html)  
5. Also update **Confirm signup** from [`confirm-signup.html`](./confirm-signup.html)  
6. **Save**

The “from” name still says Supabase until you add custom SMTP
(**Authentication → SMTP Settings**) with from name `Lakshmimata`.

Also under **Authentication → URL Configuration**:

- **Site URL** = your live app (e.g. `https://lakshmimata.vercel.app`)
- **Redirect URLs** include:
  - `https://lakshmimata.vercel.app/**`
  - `https://lakshmimata.vercel.app/?reset=1`
  - local dev if needed: `http://localhost:5173/**`

Optional: **Authentication → SMTP Settings** — use your own domain so mail
is not “from supabase.io” (better deliverability + branding).

---

### 1. Reset password (Recovery)

**Subject:**
```
Lakshmimata password reset
```

**Body:** paste the full HTML from [`recovery.html`](./recovery.html)

---

### 2. Confirm signup

**Subject:**
```
Confirm your Lakshmimata account
```

**Body:** paste the full HTML from [`confirm-signup.html`](./confirm-signup.html)

---

## What users see

Recovery email explains:

1. Click **Set a new password**
2. Enter the new password twice on the Lakshmimata screen
3. Rules: 10+ characters, letters + numbers
4. Link expiry / ignore-if-not-you note

The app already shows the **Set a new password** screen when the link
opens with `?reset=1`.
