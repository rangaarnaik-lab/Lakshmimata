# Server patches & ops (lakshmimata-server)

Worker code lives in
[`rangaarnaik-lab/lakshmimata-server`](https://github.com/rangaarnaik-lab/lakshmimata-server)
(`fundamentals_worker.py`). Apply patches there, then redeploy on Railway.

## Your 5–6+ Gemini keys (Railway)

**Any** Railway variable whose name starts with `GEMINI_API_KEY` is picked up — no limit.

Example with 6 keys:

```bash
GEMINI_API_KEY=AIza...          # default / PPT / concall
GEMINI_API_KEY_ABOUT=AIza...
GEMINI_API_KEY_RESULTS=AIza...
GEMINI_API_KEY_THEMES=AIza...
GEMINI_API_KEY_2=AIza...
GEMINI_API_KEY_3=AIza...
GEMINI_API_KEY_4=AIza...
```

After deploy + patch, startup should log:

```text
📘 About/Results Gemini pool: 6 unique key(s) from 6 env var(s) — …xxxx, …yyyy, …
📘 Gemini env vars: GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3, ...
```

Each request **round-robins** across all keys; on 429 it tries the **next** key before pausing.

**Important:** Keys must be from **different Google AI Studio projects** to get separate free-tier quotas. Six copies of the same project still share one daily limit.

Optional with many keys:

```bash
GEMINI_MAX_CONCURRENT=2    # 2 parallel calls (each key has its own cap)
ABOUT_COMPANY_CONCURRENCY=2
```

## Start Results + About now (Railway env)

Set these on the **fundamentals** service, then **Redeploy**:

```bash
GEMINI_FOCUS=all
PAUSE_ABOUT_COMPANY=0
ABOUT_COMPANY_BATCH_SIZE=3
ABOUT_COMPANY_CONCURRENCY=1
ABOUT_COMPANY_CYCLE_SECONDS=300
GEMINI_ABOUT_MODEL=gemini-2.0-flash-lite
GEMINI_CONCALL_MODEL=gemini-2.0-flash-lite
ABOUT_COMPANY_HARD_QUOTA_COOLDOWN_SECONDS=3600
GEMINI_JOBS_HARD_PAUSE_SECONDS=1800
```

If the worker was stuck in a 24h pause from earlier 429s, redeploying clears in-memory pause state.

## Supabase SQL (required for Ask AI)

Run in Supabase SQL editor:

`supabase/migrations/009_stock_ai_asks.sql`

Stops the repeating log line: `💬 Ask-AI: run add_stock_ai_asks.sql`

## `gemini-key-rotation-7468.patch` (apply first)

Rotates through **all** `GEMINI_API_KEY*` on 429 instead of stopping after one key:

```bash
cd lakshmimata-server
git am /path/to/gemini-key-rotation-7468.patch
git push origin main
# Redeploy fundamentals on Railway
```

## Log diagnosis (Aug 2026 example)

### 1. `💬 Ask-AI: run add_stock_ai_asks.sql`

The `stock_ai_asks` table is missing in Supabase. **Fix:** run migration in this repo:

`supabase/migrations/009_stock_ai_asks.sql`

Until that runs, Ask AI in the chart panel cannot queue questions (repeats every ~10 min in logs).

### 2. `429 HARD QUOTA` on About / Results

This is **not** “tokens cost money” — it is **free-tier daily / per-minute limits** per API key / Google Cloud project.

Typical sequence from logs:

| Time | What happened |
|------|----------------|
| 02:55 | About batch: 1 ok (VCL), 3× 429 → **24h About pause** until `2026-08-10T02:55Z` |
| 03:00–03:06 | Results catchup runs, then **2h hard stop** on LUMAXIND 429 until `05:06Z` |
| 05:06 | 2h stop clears, but `GEMINI_FOCUS=about` keeps **Results paused** while About “has quota” |
| 05:06–07:45+ | About still in **24h pause** → worker mostly idle (announcements only) |

**Railway env fixes (pick what you need):**

```bash
# Let Results and About share time instead of About blocking Results for 24h
GEMINI_FOCUS=all

# Softer About pacing (defaults are aggressive: batch=10, concurrency=3, cycle=60s)
ABOUT_COMPANY_BATCH_SIZE=3
ABOUT_COMPANY_CONCURRENCY=1
ABOUT_COMPANY_CYCLE_SECONDS=300

# Use lite model for About (higher free RPM on many keys)
GEMINI_ABOUT_MODEL=gemini-2.0-flash-lite

# Shorter pauses after quota (optional — defaults are 24h About / 2h global)
# GEMINI_ABOUT_HARD_PAUSE_SECONDS=3600
# GEMINI_JOBS_HARD_PAUSE_SECONDS=1800
```

**Keys:** You have 4 keys in round-robin, but About was still using **dedicated** `GEMINI_API_KEY_ABOUT` for calls. Apply the patch below so About/Results **fall back to any** `GEMINI_API_KEY*` when the dedicated key is exhausted.

**Billing:** If keys are on **paid** tier but show “check billing”, open [Google AI Studio](https://aistudio.google.com/) → project → Billing / quotas. Free tier resets daily (Pacific); paid tier needs billing enabled.

### 3. `503 UNAVAILABLE` on Results

Temporary Gemini overload — worker already soft-backs off 180s and retries (INDLMETER succeeded after retry).

### 4. `R2 not configured`

Optional — frontend reads announcements from Supabase directly. Safe to ignore unless you want R2 snapshots.

---

## `results-catchup-idle-lookback-7468.patch`

1. **90d catchup** lookback kept.
2. **Idle backoff** — empty Results catchup sleeps 30m (less log spam).
3. **YoY/comparison dedupe** when Gemini dual-labels the same period.
4. **Company Overview handoff** — when Results catchup is idle, populate About every **15 minutes**.
5. **Any Gemini key** — About and Results prefer their feature key, then fall back across every `GEMINI_API_KEY*`.

### Apply

```bash
cd lakshmimata-server
git am /path/to/results-catchup-idle-lookback-7468.patch
git push origin main   # redeploy fundamentals on Railway
```
