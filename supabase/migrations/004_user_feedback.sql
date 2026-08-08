-- User feedback (app reviews) — public quotes on landing page, submit when signed in.
create table if not exists public.user_feedback (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  display_name  text not null default 'Trader',
  message       text not null check (char_length(message) >= 5 and char_length(message) <= 1000),
  rating        smallint check (rating is null or (rating >= 1 and rating <= 5)),
  is_public     boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists user_feedback_public_created_idx
  on public.user_feedback (created_at desc)
  where is_public = true;

alter table public.user_feedback enable row level security;

create policy "public feedback readable by anyone"
  on public.user_feedback for select
  using (is_public = true);

create policy "users read own feedback"
  on public.user_feedback for select
  using (auth.uid() = user_id);

create policy "users insert own feedback"
  on public.user_feedback for insert
  with check (auth.uid() = user_id);
