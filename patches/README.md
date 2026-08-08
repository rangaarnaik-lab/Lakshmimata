# Server patches (apply in `lakshmimata-server`)

This Cloud Agent run was started on the **Lakshmimata** frontend repo, but the
Results extraction loop that produced the Railway logs lives in
[`rangaarnaik-lab/lakshmimata-server`](https://github.com/rangaarnaik-lab/lakshmimata-server)
(`fundamentals_worker.py`). Write access to that repo was denied from this run.

## `results-catchup-idle-lookback-7468.patch`

Fixes three issues visible in the 2026-08-08 catchup logs:

1. **Catchup lookback stuck at 90d** — catchup was inheriting
   `RESULTS_PDF_LOOKBACK_DAYS` (often 90 for steady-state), so it went idle
   (`nothing new`) inside a 90-day window while older filings still needed
   extraction. Catchup now defaults to **365 days** independently.
2. **Idle log spam** — empty catchup cycles slept 20s and logged every cycle.
   Now sleeps **30 minutes** when the queue is empty (About-company pattern)
   and only heartbeats occasionally.
3. **GREENPANEL YoY/comparison collision** — when Gemini labels the same
   period as both comparison and YoY, keep YoY only before saving (avoids
   duplicate rows / bad QoQ%).

### Apply

```bash
cd lakshmimata-server
git am /path/to/results-catchup-idle-lookback-7468.patch
# or: git apply /path/to/results-catchup-idle-lookback-7468.patch
```

### Also run in Supabase (Ask-AI warning in logs)

```bash
# In Supabase SQL editor:
# contents of lakshmimata-server/add_stock_ai_asks.sql
```

The worker log `💬 Ask-AI: run add_stock_ai_asks.sql` means that migration
has not been applied yet.
