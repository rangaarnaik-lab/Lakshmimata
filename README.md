# PocketRS Pro — NSE Stock Scanner

Full-featured NSE scanner: RS Rating, Pocket Pivot, 52WL Crossover, Weak RS, Sector RS, Watchlists.

## Quick Start

### 1. Clone & install
```bash
git clone <your-repo>
cd pocketrs-pro
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Fill in your Supabase URL, anon key, and optionally your Upstox token
```

### 3. Set up Supabase (one-time)
- Go to https://supabase.com → New Project
- In SQL Editor, run this:

```sql
create table if not exists public.user_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null unique,
  upstox_token text not null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table public.user_tokens enable row level security;
create policy "owner can select" on public.user_tokens for select using (auth.uid() = user_id);
create policy "owner can insert" on public.user_tokens for insert with check (auth.uid() = user_id);
create policy "owner can update" on public.user_tokens for update using (auth.uid() = user_id);
create policy "owner can delete" on public.user_tokens for delete using (auth.uid() = user_id);
```

### 4. Run locally
```bash
npm run dev
# Opens at http://localhost:5173
```

### 5. Deploy to Vercel (free)
```bash
npm install -g vercel
vercel
# Or connect GitHub repo at vercel.com for auto-deploy
```

## Owner Token Setup
Set `VITE_OWNER_UPSTOX_TOKEN` in your `.env` (locally) and in Vercel environment variables.
Users sign in but don't need their own Upstox token — they use yours automatically.
They can optionally override with their own in Account Settings.

## Upstox Token Renewal
Upstox daily access tokens expire every day. To auto-renew, use Upstox's OAuth refresh flow
and update `VITE_OWNER_UPSTOX_TOKEN` in Vercel env vars, then redeploy.
Or use a backend cron job to refresh and store the new token.

## Features
- 📊 RS Rating — IBD-style 1-99 percentile vs all scanned stocks
- 📈 15-day RS history with sparklines per stock
- 🔥 Pocket Pivot scanner with 10-day PP count and dot history
- 🎯 52-Week Low Crossover — 5-EMA cross + PP volume
- 🚨 Weak RS Big Move — RS<50 but moved >8% (customizable)
- 🏭 Sector RS — Nifty50 + Midcap + Smallcap sector rankings
- 📋 Custom Watchlists — manual add + CSV drag-drop upload
- 📊 TradingView copy — Pine Script, NSE:SYM, Alert list formats
- 🔄 Auto-refresh — 5/10/15/30 min intervals with countdown
- 🔒 Supabase Auth — bcrypt passwords, JWT, Row Level Security
- 📱 Fully mobile responsive with bottom tab navigation
