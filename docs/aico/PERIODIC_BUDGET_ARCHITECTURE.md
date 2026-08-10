# Aico Periodic Budget Architecture

**Branch:** `feat/aico-140-org-period-budgets`  
**Audience:** engineering + ops

## Goals

- Product member budgets are **`daily | weekly | monthly` only** (legacy `total` grandfathered until converted/revoked).
- OpenRouter Management API owns hard spend limits via `limit` + `limit_reset`.
- Aico wallet reservations are the product financial source of truth.
- Organization wallet never goes negative; unfunded periods never enable keys.
- Renewal is server-side, idempotent, multi-instance safe, independent of user online status.

## Money units

| Unit | Storage | API |
|---|---|---|
| USD | `bigint` micro-USD (`1 USD = 1_000_000`) | decimal string (`"12.345678"`) |
| Toman | `bigint` Toman | integer string |

Helpers: `packages/database/src/utils/aicoMoney.ts`.

## OpenRouter mapping

| Aico `period` | OR `limit_reset` | Boundary |
|---|---|---|
| `daily` | `daily` | midnight UTC |
| `weekly` | `weekly` | Monday 00:00 UTC → Sunday |
| `monthly` | `monthly` | 1st of month 00:00 UTC |
| `total` (legacy only) | `null` | no auto reset — blocked on new allocates (AICO-140) |

**Product (AICO-140):** org member budgets are **daily / weekly / monthly only**. Amount is a **set/replace recurring cap** (unused does not roll over). Period changes between product periods queue until the current boundary and are **prepaid once** (renewal does not re-debit the pending hold). Converting grandfathered `total` → a product period applies **immediately** (renewal never selects `total`).

UI must display boundaries in the user’s local timezone while DB stores UTC.

## Cron entrypoints

| Job | Route | Auth |
|---|---|---|
| Due renewals | `GET /api/aico/cron/process-renewals` | `Authorization: Bearer $CRON_SECRET` |
| Key outbox | `GET /api/aico/cron/process-key-outbox` | same |

Suggested intervals: renewals every 1–5 min; outbox every 1 min.

These routes are invoked by a **self-hosted** scheduler (crontab / systemd / k8s CronJob) via HTTP — not Vercel Cron and not `vercel.json`. See [`RENEWAL_SETTLEMENT_RUNBOOK.md`](./RENEWAL_SETTLEMENT_RUNBOOK.md).

Failed renewal batches delete their unique `batch_key` on the next attempt after org wallet top-up so recovery can succeed.

## Period funding lifecycle

1. Allocate/renew: CAS-debit org `wallet_balance_micro_usd` for the **delta** when increasing a same-period cap, or the full next-period amount when creating / queuing a period change.
2. Persist reservation on `member_budgets` (`reserved_micro_usd`, window fields, `renewal_status=active`).
3. Upsert stable member OpenRouter key with matching `limit` + `limit_reset` (never delete/recreate on normal renewal). OR live limit uses **current-cycle `periodAmount` only** (never pending).
4. At boundary: mark `renewal_pending` + disable OR keys → sync authoritative OR remaining (prefer `limit_remaining` / period usage; guard against post-reset counters) → refund closing-cycle unused → CAS-debit **only unfunded** next-cap slice (skip prepaid pending) → enable keys only if funded.

## All-or-none renewal

For budgets due in the same org batch:

- If gross required > available wallet after confirmed refunds applied in-settlement: renew **none**, leave due keys disabled, record shortfall, notify managers.
- Budgets not yet due remain active.

Idempotency: `aico_renewal_batches.batch_key` UNIQUE (`orgId + boundaryIso`).

## Scheduler

`apps/server/src/services/aico/renewalScheduler.ts`

- `processDueRenewals(db)`
- `processKeyOutbox(db)` — revoke/disable OR keys after local `revocation_pending`

Must be: idempotent, lock-safe, retryable, observable, restart-safe.

## Adjustment rules

- **Increase:** require wallet funds; reserve delta; PATCH OR limit.
- **Decrease:** sync usage first; never below consumed; refund confirmed safe delta only.
- **Period-type change (D/W/M):** prefer next renewal boundary via `pending_period` / `pending_period_amount_micro_usd`.
- **Legacy `total` → D/W/M:** apply in place immediately (do not queue pending).

## Explicit billing context

Every managed request must include:

```ts
{ source: 'personal' } | { source: 'organization', organizationId: string }
```

No first-match / personal-first / org-first fallback. Preference fields on `user_wallets` are UX only.
