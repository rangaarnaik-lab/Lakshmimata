# Server patches (apply in `lakshmimata-server`)

This Cloud Agent run was started on the **Lakshmimata** frontend repo, but the
Results extraction loop that produced the Railway logs lives in
[`rangaarnaik-lab/lakshmimata-server`](https://github.com/rangaarnaik-lab/lakshmimata-server)
(`fundamentals_worker.py`). Write access to that repo was denied from this run.

## `results-catchup-idle-lookback-7468.patch`

Fixes issues visible in the 2026-08-08 catchup logs (**90-day lookback kept**):

1. **Idle log spam** — empty catchup cycles slept 20s and logged every cycle.
   Now sleeps **30 minutes** when the queue is empty (About-company pattern)
   and only heartbeats occasionally.
2. **GREENPANEL YoY/comparison collision** — when Gemini labels the same
   period as both comparison and YoY, keep YoY only before saving (avoids
   duplicate rows / bad QoQ%).
3. Catchup default lookback is **90 days** (same as steady-state).

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
