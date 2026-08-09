-- Chart panel size in saved layouts (expand preset + custom drag %).
alter table public.user_layouts
  add column if not exists chart_wide smallint not null default 0 check (chart_wide >= 0 and chart_wide <= 2),
  add column if not exists chart_panel_pct real;
