# Server patches (apply in `lakshmimata-server`)

This Cloud Agent run was started on the **Lakshmimata** frontend repo, but the
Results extraction loop that produced the Railway logs lives in
[`rangaarnaik-lab/lakshmimata-server`](https://github.com/rangaarnaik-lab/lakshmimata-server)
(`fundamentals_worker.py`). Write access to that repo was denied from this run.

## `results-catchup-idle-lookback-7468.patch`

Fixes for the 2026-08-08 Results catchup logs (**90-day lookback kept**):

1. **Idle backoff** — empty catchup sleeps **30 minutes** (was ~20s spam).
2. **YoY/comparison dedupe** — when Gemini labels the same period as both
   comparison and YoY, keep YoY only.
3. **Company Overview handoff** — when Results catchup is idle (“nothing
   new”), release `PAUSE_ABOUT_COMPANY` early and populate About /
   Company Overview every **15 minutes**. If Results finds new work again,
   About yields back.

### Apply

```bash
cd lakshmimata-server
git am /path/to/results-catchup-idle-lookback-7468.patch
# or: git apply /path/to/results-catchup-idle-lookback-7468.patch
git push origin main   # then redeploy fundamentals on Railway
```

### Env (optional)

| Var | Default | Meaning |
|---|---|---|
| `ABOUT_COMPANY_CYCLE_SECONDS` | `900` (after Results idle) | Minutes between About batches |
| `RESULTS_PDF_CATCHUP_DONE_SECONDS` | `1800` | Results recheck while idle |
| `RESULTS_PDF_CATCHUP_LOOKBACK_DAYS` / `RESULTS_PDF_LOOKBACK_DAYS` | `90` | Catchup window |

### Also run in Supabase (Ask-AI warning in logs)

```bash
# In Supabase SQL editor: lakshmimata-server/add_stock_ai_asks.sql
```
