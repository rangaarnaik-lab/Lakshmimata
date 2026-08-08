-- Up to 3 saved UI layouts per user (RS columns + chart section order).
create table if not exists public.user_layouts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade not null,
  slot            smallint not null check (slot >= 1 and slot <= 3),
  name            text not null,
  columns         jsonb not null default '{}',
  col_order       jsonb not null default '[]',
  chart_sections  jsonb not null default '["mcap","themes","mgmt","details"]',
  updated_at      timestamptz not null default now(),
  unique (user_id, slot)
);

create index if not exists user_layouts_user_idx on public.user_layouts (user_id, slot);

alter table public.user_layouts enable row level security;

create policy "users read own layouts"
  on public.user_layouts for select
  using (auth.uid() = user_id);

create policy "users insert own layouts"
  on public.user_layouts for insert
  with check (auth.uid() = user_id);

create policy "users update own layouts"
  on public.user_layouts for update
  using (auth.uid() = user_id);

create policy "users delete own layouts"
  on public.user_layouts for delete
  using (auth.uid() = user_id);
