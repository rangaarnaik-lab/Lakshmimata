# Server patches (apply in `lakshmimata-server`)

This Cloud Agent run was started on the **Lakshmimata** frontend repo, but the
Results extraction / About Company worker lives in
[`rangaarnaik-lab/lakshmimata-server`](https://github.com/rangaarnaik-lab/lakshmimata-server)
(`fundamentals_worker.py`). Write access to that repo was denied from this run.

## `results-catchup-idle-lookback-7468.patch`

1. **90d catchup** lookback kept.
2. **Idle backoff** — empty Results catchup sleeps 30m (less log spam).
3. **YoY/comparison dedupe** when Gemini dual-labels the same period.
4. **Company Overview handoff** — when Results catchup is idle, release
   `PAUSE_ABOUT_COMPANY` and populate About every **15 minutes**.
5. **Any Gemini key** — About and Results prefer their feature key, then
   fall back across every `GEMINI_API_KEY*` (same idea as Ask-AI).

### Apply

```bash
cd lakshmimata-server
git am /path/to/results-catchup-idle-lookback-7468.patch
git push origin main   # redeploy fundamentals on Railway
```
