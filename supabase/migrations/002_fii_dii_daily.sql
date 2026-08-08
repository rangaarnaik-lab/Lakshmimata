-- Daily FII/FPI & DII cash-market flows (NSE provisional, published post close)
create table if not exists public.fii_dii_daily (
  trade_date   date primary key,
  segment      text not null default 'combined', -- combined = NSE+BSE+MSEI (fiidiiTradeReact)
  fii_buy      numeric,
  fii_sell     numeric,
  fii_net      numeric,
  dii_buy      numeric,
  dii_sell     numeric,
  dii_net      numeric,
  source       text default 'nse',
  fetched_at   timestamptz default now()
);

alter table public.fii_dii_daily enable row level security;
create policy "auth read fii_dii_daily" on public.fii_dii_daily
  for select using (auth.role() = 'authenticated');

create index if not exists idx_fii_dii_daily_date on public.fii_dii_daily(trade_date desc);
