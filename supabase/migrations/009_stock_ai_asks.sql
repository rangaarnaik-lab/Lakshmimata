-- Ask AI agent queue (chart panel). Worker picks pending rows and answers via Gemini.
create table if not exists public.stock_ai_asks (
  id           uuid primary key default gen_random_uuid(),
  symbol       text not null,
  question     text not null check (char_length(question) between 8 and 400),
  status       text not null default 'pending'
                 check (status in ('pending', 'done', 'error')),
  ask_mode     text not null default 'filings'
                 check (ask_mode in ('filings', 'web')),
  answer       text,
  verdict      text,
  flags        jsonb,
  sources      jsonb,
  error        text,
  visitor_id   text,
  user_id      uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  answered_at  timestamptz
);

create index if not exists stock_ai_asks_pending_idx
  on public.stock_ai_asks (created_at asc)
  where status = 'pending';

create index if not exists stock_ai_asks_symbol_done_idx
  on public.stock_ai_asks (symbol, answered_at desc)
  where status = 'done';

alter table public.stock_ai_asks enable row level security;

create policy "anyone can queue stock ai ask"
  on public.stock_ai_asks for insert
  with check (true);

create policy "anyone can read stock ai asks"
  on public.stock_ai_asks for select
  using (true);

-- Service role (fundamentals worker) updates pending → done/error via service key.
