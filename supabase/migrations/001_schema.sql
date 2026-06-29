-- ═══════════════════════════════════════════════════════════════
-- PocketRS Pro — Complete Supabase Schema
-- Run this in Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. User tokens table
create table if not exists public.user_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade not null unique,
  upstox_token text not null,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
alter table public.user_tokens enable row level security;
create policy "owner select" on public.user_tokens for select using (auth.uid() = user_id);
create policy "owner insert" on public.user_tokens for insert with check (auth.uid() = user_id);
create policy "owner update" on public.user_tokens for update using (auth.uid() = user_id);
create policy "owner delete" on public.user_tokens for delete using (auth.uid() = user_id);

-- 2. Owner token (analytics token — never expires)
create table if not exists public.owner_token (
  id         text primary key default 'owner',
  token      text not null,
  updated_at timestamptz default now()
);
alter table public.owner_token enable row level security;
create policy "public read" on public.owner_token for select using (true);

-- 3. Main stocks table — stores all signals for every stock
create table if not exists public.stocks (
  sym              text primary key,
  -- Basic price data
  last_price       numeric,
  open             numeric,
  high             numeric,
  low              numeric,
  close            numeric,
  prev_close       numeric,
  chg_pct          numeric,        -- day change %
  volume           bigint,
  -- RS Rating
  rs               int,            -- RS Rating 1-99
  rs_raw           numeric,        -- raw RS score
  rs_trend         text,           -- improving / declining / flat
  rs_slope         numeric,        -- RS slope per day
  rs_hist          jsonb,          -- last 15 days RS history array
  -- Pocket Pivot
  is_pp            boolean,        -- today is pocket pivot
  pp_count_10d     int,            -- PP count in last 10 days
  pp_hist          jsonb,          -- last 10 days PP history array
  pp_vol_ratio     numeric,        -- volume ratio
  ma10             numeric,
  ma50             numeric,
  -- Volume signals
  is_hy            boolean,        -- 52W high volume
  hy_pct           numeric,        -- % of 52W max volume
  is_ht            boolean,        -- all-time high volume (since IPO)
  ht_pct           numeric,        -- % of all-time max volume
  -- EMA signals
  ema9             numeric,
  near_ema9        boolean,        -- RS 90+ and within 3% of EMA9
  pct_from_ema9    numeric,
  -- 52WL scanner
  low_52w          numeric,
  high_52w         numeric,
  pct_from_52wl    numeric,
  near_52wl        boolean,        -- within 15% of 52W low
  crossed_ema5     boolean,        -- crossed above 5-day EMA today
  pp_volume_52wl   boolean,        -- pocket pivot volume
  is_52wl_signal   boolean,        -- all 3 conditions met
  ema5             numeric,
  -- Weak RS big move
  is_weak_rs       boolean,        -- RS < 50 and moved > threshold%
  weak_chg_1d      numeric,
  weak_chg_5d      numeric,
  weak_vol_spike   numeric,
  -- Sector
  sector           text,
  -- Index membership
  in_nifty50       boolean default false,
  in_midcap        boolean default false,
  in_smallcap      boolean default false,
  in_microcap      boolean default false,
  -- Meta
  last_updated     timestamptz default now(),
  scan_type        text            -- 'batch_morning' | 'live' | 'batch_eod'
);
alter table public.stocks enable row level security;
-- Allow all authenticated users to read
create policy "auth read stocks" on public.stocks for select using (auth.role() = 'authenticated');
-- Only service role (batch script) can write
-- (no insert/update policy for anon/authenticated — only service_role key)

-- 4. Sector summary table
create table if not exists public.sectors (
  sector       text primary key,
  avg_rs       int,
  rank         int,
  count        int,
  pp_count     int,
  improving    int,
  top_stocks   jsonb,           -- top 5 stocks with RS
  last_updated timestamptz default now()
);
alter table public.sectors enable row level security;
create policy "auth read sectors" on public.sectors for select using (auth.role() = 'authenticated');

-- 5. Scan metadata — track when last scan ran
create table if not exists public.scan_meta (
  id           text primary key,   -- 'latest'
  last_scan    timestamptz,
  scan_type    text,               -- 'batch_morning' | 'live' | 'batch_eod'
  stocks_count int,
  duration_sec numeric,
  status       text,               -- 'success' | 'error'
  error_msg    text,
  next_scan    timestamptz
);
alter table public.scan_meta enable row level security;
create policy "auth read meta" on public.scan_meta for select using (auth.role() = 'authenticated');

-- 6. Indexes for fast queries
create index if not exists idx_stocks_rs on public.stocks(rs desc);
create index if not exists idx_stocks_sector on public.stocks(sector);
create index if not exists idx_stocks_is_pp on public.stocks(is_pp) where is_pp = true;
create index if not exists idx_stocks_52wl on public.stocks(is_52wl_signal) where is_52wl_signal = true;
create index if not exists idx_stocks_weak on public.stocks(is_weak_rs) where is_weak_rs = true;
create index if not exists idx_stocks_updated on public.stocks(last_updated desc);

-- 7. Seed scan_meta
insert into public.scan_meta (id, status) values ('latest', 'pending')
on conflict (id) do nothing;
