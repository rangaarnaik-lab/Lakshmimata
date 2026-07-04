-- ═══════════════════════════════════════════════════════════════
-- Daily History Snapshot Table
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════
-- Stores one full copy of the `stocks` table's columns per stock,
-- per trading day. Written once per day by the EOD scan on Railway.
-- This lets the app replay any past date across every scanner.

create table if not exists public.stock_history (
  id               bigint generated always as identity primary key,
  snapshot_date    date not null,           -- trading date this row represents (IST)
  sym              text not null,
  last_price       numeric,
  open             numeric,
  high             numeric,
  low              numeric,
  close            numeric,
  prev_close       numeric,
  chg_pct          numeric,
  volume           bigint,
  rs               int,
  rs_nifty50       int,
  rs_midcap        int,
  rs_smallcap      int,
  rs_microcap      int,
  rs_sector        int,
  rs_raw           numeric,
  rs_trend         text,
  rs_slope         numeric,
  rs_hist          jsonb,
  is_pp            boolean,
  pp_count_10d     int,
  pp_hist          jsonb,
  pp_vol_ratio     numeric,
  ma10             numeric,
  ma50             numeric,
  is_hy            boolean,
  hy_pct           numeric,
  is_ht            boolean,
  ht_pct           numeric,
  ema9             numeric,
  near_ema9        boolean,
  pct_from_ema9    numeric,
  low_52w          numeric,
  high_52w         numeric,
  pct_from_52wl    numeric,
  near_52wl        boolean,
  crossed_ema5     boolean,
  pp_volume_52wl   boolean,
  is_52wl_signal   boolean,
  ema5             numeric,
  is_weak_rs       boolean,
  weak_chg_1d      numeric,
  weak_chg_5d      numeric,
  weak_vol_spike   numeric,
  in_squeeze       boolean,
  squeeze_fired    boolean,
  bb_width_pct     numeric,
  squeeze_days     int,
  is_vcp           boolean,
  vcp_stage        int,
  vcp_fired        boolean,
  vcp_contractions jsonb,
  sector           text,
  in_nifty50       boolean,
  in_midcap        boolean,
  in_smallcap      boolean,
  in_microcap      boolean,
  created_at       timestamptz default now(),

  unique (snapshot_date, sym)   -- one row per stock per day, upsert-safe
);

alter table public.stock_history enable row level security;

create policy "auth read stock_history" on public.stock_history
  for select using (auth.role() = 'authenticated');

-- Indexes for fast date-based and sector-based queries
create index if not exists idx_history_date        on public.stock_history(snapshot_date desc);
create index if not exists idx_history_date_rs      on public.stock_history(snapshot_date, rs desc);
create index if not exists idx_history_date_sector  on public.stock_history(snapshot_date, sector);
create index if not exists idx_history_sym_date     on public.stock_history(sym, snapshot_date desc);

-- Sector history too, so the Sectors tab can also be replayed by date
create table if not exists public.sector_history (
  id            bigint generated always as identity primary key,
  snapshot_date date not null,
  sector        text not null,
  avg_rs        int,
  rank          int,
  count         int,
  pp_count      int,
  improving     int,
  top_stocks    jsonb,
  created_at    timestamptz default now(),
  unique (snapshot_date, sector)
);

alter table public.sector_history enable row level security;
create policy "auth read sector_history" on public.sector_history
  for select using (auth.role() = 'authenticated');

create index if not exists idx_sector_history_date on public.sector_history(snapshot_date desc);

-- List of dates that have a complete snapshot available (for populating the date picker)
create or replace view public.available_history_dates as
  select distinct snapshot_date
  from public.stock_history
  order by snapshot_date desc;

select 'stock_history + sector_history tables created! ✅' as result;

-- TV-style RS Rating column (TradingView / Lakshmi Mata Pine Script formula)
alter table public.stocks       add column if not exists rs_tv int;
alter table public.stock_history add column if not exists rs_tv int;
create index if not exists idx_stocks_rs_tv on public.stocks(rs_tv desc) where rs_tv is not null;

select 'TV RS Rating column added! ✅' as result;

-- Index Dashboard table
create table if not exists public.index_dashboard (
  name           text primary key,
  last_price     numeric,
  chg_d          numeric,    -- daily % change
  chg_w          numeric,    -- weekly % change
  chg_m          numeric,    -- monthly % change
  chg_q          numeric,    -- quarterly % change
  chg_y          numeric,    -- yearly % change
  rs_tv          int,        -- RS rating (TV/Lakshmi Mata formula vs Nifty)
  stage          int,        -- Weinstein stage 1-4
  stage_label    text,
  above_ma10     boolean,
  above_ma30     boolean,
  high_52w       numeric,
  low_52w        numeric,
  pct_from_high  numeric,
  top_stocks     jsonb,      -- top 3 RS stocks in this index
  bot_stocks     jsonb,      -- bottom 3 RS stocks in this index
  last_updated   timestamptz default now()
);

alter table public.index_dashboard enable row level security;
create policy "auth read index_dashboard" on public.index_dashboard
  for select using (auth.role() = 'authenticated');

select 'Index dashboard table created! ✅' as result;

-- Fundamental data columns (from Screener.in, refreshed every 6h)
alter table public.stocks add column if not exists market_cap numeric;
alter table public.stocks add column if not exists pe numeric;
alter table public.stocks add column if not exists roe numeric;
alter table public.stocks add column if not exists eps numeric;
alter table public.stocks add column if not exists debt_eq numeric;
alter table public.stocks add column if not exists promoter numeric;

select 'Fundamentals columns added! ✅' as result;

-- Market Breadth table
create table if not exists public.market_breadth (
  scan_date        date primary key,
  total_stocks     int,
  above_ma10       int, above_ma50 int,
  rs_above_70      int, rs_above_50 int,
  rs_improving     int, rs_declining int,
  stage2_count     int, stage4_count int,
  new_52w_high     int, new_52w_low int,
  pp_count         int, rvol_surge int,
  s2_new_entry     int, rs_line_new_high int,
  advances         int, declines int,
  last_updated     timestamptz default now()
);
alter table public.market_breadth disable row level security;

-- New columns on stocks table
alter table public.stocks add column if not exists rvol numeric;
alter table public.stocks add column if not exists vol_signal text;
alter table public.stocks add column if not exists rs_line_new_high boolean default false;
alter table public.stocks add column if not exists rs_line_trend text;
alter table public.stocks add column if not exists rs_line_value numeric;
alter table public.stocks add column if not exists is_s2_new_entry boolean default false;

select 'All new columns added! ✅' as result;

-- Squeeze fire alerts table
create table if not exists public.squeeze_alerts (
  id         bigint generated always as identity primary key,
  sym        text not null,
  fire_type  text,           -- 'BB Squeeze', 'VCP', or 'BB Squeeze, VCP'
  rs_tv      int,
  rs         int,
  last_price numeric,
  chg_pct    numeric,
  sector     text,
  fired_at   timestamptz not null default now(),
  unique (sym, fired_at)
);
alter table public.squeeze_alerts disable row level security;
create index if not exists idx_squeeze_alerts_fired on public.squeeze_alerts(fired_at desc);

select 'Squeeze alerts table created! ✅' as result;

-- TTM Squeeze multi-timeframe columns
alter table public.stocks add column if not exists sq_momentum numeric default 0;
alter table public.stocks add column if not exists sq_momentum_dir text default 'flat';
alter table public.stocks add column if not exists sq_strength numeric default 0;
alter table public.stocks add column if not exists sq_fired_bullish boolean default false;
alter table public.stocks add column if not exists sq_fired_bearish boolean default false;
alter table public.stocks add column if not exists sq_dots_d jsonb;
alter table public.stocks add column if not exists sq_hist_d jsonb;
alter table public.stocks add column if not exists sq_weekly_in boolean default false;
alter table public.stocks add column if not exists sq_weekly_fired boolean default false;
alter table public.stocks add column if not exists sq_weekly_days int default 0;
alter table public.stocks add column if not exists sq_weekly_mom numeric default 0;
alter table public.stocks add column if not exists sq_weekly_mom_dir text default 'flat';
alter table public.stocks add column if not exists sq_weekly_bullish boolean default false;
alter table public.stocks add column if not exists sq_hourly_in boolean default false;
alter table public.stocks add column if not exists sq_hourly_fired boolean default false;
alter table public.stocks add column if not exists sq_hourly_days int default 0;
alter table public.stocks add column if not exists sq_hourly_mom numeric default 0;
alter table public.stocks add column if not exists sq_hourly_mom_dir text default 'flat';
alter table public.stocks add column if not exists sq_hourly_bullish boolean default false;
alter table public.stocks add column if not exists pct_from_52wh numeric;
alter table public.stocks add column if not exists pct_from_52wl numeric;

select 'TTM Squeeze columns added! ✅' as result;
