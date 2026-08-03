# Aico Renewal & Settlement Runbook

## Cron / worker entrypoints

Schedule (suggested):

| Job | Interval | Function |
|---|---|---|
| Due renewals | every 1–5 min | `processDueRenewals(db)` |
| Key outbox | every 1 min | `processKeyOutbox(db)` |
| Usage sync | every 15 min | sync active member keys |
| Daily reconcile | daily | full org usage vs OR usage |
| Master monitor | every 15 min | update `aico_master_monitor_state` |

## Operator checks

1. **Org wallet negative?** Should be impossible (CAS). If observed, halt renewals and investigate ledger.
2. **`renewal_failed` budgets:** check `aico_renewal_batches` shortfall; top up via platform manual credit; re-run scheduler.
3. **Outbox `failed` > 1h:** alert — OR key may still be spendable; disable in OpenRouter dashboard manually using `openrouter_key_id`.
4. **Stale sync:** `member_budgets.last_sync_status` / `last_sync_error`.

## Manual settlement

```sql
-- Inspect due budgets
SELECT id, org_member_id, period, reserved_micro_usd, renewal_status, next_renewal_at
FROM member_budgets
WHERE next_renewal_at <= now() AND period <> 'total';

-- Inspect batches
SELECT * FROM aico_renewal_batches ORDER BY created_at DESC LIMIT 50;

-- Outbox backlog
SELECT * FROM aico_key_outbox WHERE status IN ('pending','failed') ORDER BY next_attempt_at;
```

## Rollback

- Disable scheduler jobs.
- Leave keys disabled (`disabled=true`) rather than re-enabling unfunded periods.
- Do not reverse journaled settlements without a compensating ledger row.

## Alerts

- Org shortfall on renewal batch
- Outbox age > 1 hour
- Master monitor `status=stale|error` or projected exhaustion < 7 days
- Mismatch: OR usage vs `settled_usage_micro_usd` beyond threshold
