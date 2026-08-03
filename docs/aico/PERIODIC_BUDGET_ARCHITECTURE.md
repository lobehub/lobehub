# Aico Periodic Budget Architecture

**Branch:** `feat/aico-final-remediation`  
**Audience:** engineering + ops

## Goals

- Member budgets support `total | daily | weekly | monthly`.
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
| `total` | `null` | no auto reset |
| `daily` | `daily` | midnight UTC |
| `weekly` | `weekly` | Monday 00:00 UTC → Sunday |
| `monthly` | `monthly` | 1st of month 00:00 UTC |

UI must display boundaries in the user’s local timezone while DB stores UTC.

## Period funding lifecycle

1. Allocate/renew: CAS-debit org `wallet_balance_micro_usd` for full `period_amount_micro_usd`.
2. Persist reservation on `member_budgets` (`reserved_micro_usd`, window fields, `renewal_status=active`).
3. Upsert stable member OpenRouter key with matching `limit` + `limit_reset` (never delete/recreate on normal renewal).
4. At boundary: mark `renewal_pending` → sync authoritative OR usage → refund `max(0, reserved - usage)` (floor) → all-or-none fund next batch for the org → enable keys only if funded.

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
- **Period-type change:** prefer next renewal boundary via `pending_period` / `pending_period_amount_micro_usd`.

## Explicit billing context

Every managed request must include:

```ts
{ source: 'personal' } | { source: 'organization', organizationId: string }
```

No first-match / personal-first / org-first fallback. Preference fields on `user_wallets` are UX only.
