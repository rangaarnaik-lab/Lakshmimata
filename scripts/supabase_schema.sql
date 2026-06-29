-- ═══════════════════════════════════════════════════════════════
-- Run this SQL in Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. User tokens table (each user's own Upstox token)
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

-- 2. Owner token table (single row — updated daily by GitHub Actions cron)
--    The app reads this at startup so no redeploy is needed when token refreshes.
create table if not exists public.owner_token (
  id         text primary key default 'owner',
  token      text not null,
  updated_at timestamptz default now()
);
alter table public.owner_token enable row level security;

-- Allow anyone (even unauthenticated) to READ the owner token
-- (it's the app owner's token, not a security risk since it's server-side read)
-- But only service_role (GitHub Actions) can write it.
create policy "public read owner token" on public.owner_token
  for select using (true);

-- No insert/update policy for anon — only service_role key (used in script) can write.

-- 3. Seed the owner_token row (replace with your actual token first time)
insert into public.owner_token (id, token, updated_at)
values ('owner', 'PASTE_YOUR_INITIAL_TOKEN_HERE', now())
on conflict (id) do update set token = excluded.token, updated_at = now();

-- ═══════════════════════════════════════════════════════════════
-- GOOGLE OAUTH SETUP (one-time in Supabase dashboard)
-- ═══════════════════════════════════════════════════════════════
-- 1. Go to: Supabase → Authentication → Providers → Google → Enable
--
-- 2. You need a Google OAuth Client ID & Secret:
--    a. Go to: console.cloud.google.com
--    b. Create a new project (or use existing)
--    c. APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID
--    d. Application type: Web application
--    e. Authorized redirect URIs — add BOTH:
--       https://YOUR_PROJECT.supabase.co/auth/v1/callback
--       http://localhost:5173  (for local dev)
--    f. Copy the Client ID and Client Secret
--
-- 3. Back in Supabase → Authentication → Providers → Google:
--    - Paste Client ID
--    - Paste Client Secret
--    - Save
--
-- 4. In Supabase → Authentication → URL Configuration:
--    - Site URL: https://your-app.vercel.app
--    - Add to Redirect URLs: https://your-app.vercel.app/**
--    - Also add: http://localhost:5173/** (for local dev)
--    - Save
--
-- That's it! Google sign-in will now work.
-- Users who sign in with Google automatically get an account.
-- ═══════════════════════════════════════════════════════════════
