-- Leader flags for historical replay (Leaders tab).
alter table public.stock_history add column if not exists rs_line_new_high boolean default false;
alter table public.stock_history add column if not exists rs_line_trend text;
alter table public.stock_history add column if not exists rs_line_value numeric;
alter table public.stock_history add column if not exists is_s2_new_entry boolean default false;

create index if not exists idx_history_date_rsln
  on public.stock_history (snapshot_date)
  where rs_line_new_high = true;

create index if not exists idx_history_date_s2new
  on public.stock_history (snapshot_date)
  where is_s2_new_entry = true;
