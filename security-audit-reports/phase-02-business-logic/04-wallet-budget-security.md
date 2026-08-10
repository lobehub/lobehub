# Wallet, Credit & Budget Security Audit

| Field              | Value                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| **Plane**          | [AICO-105](https://plane.panafor.com/panaforai/browse/AICO-105/)                                   |
| **Phase**          | Phase 2 — Business Logic & Multi-Tenancy Security                                                  |
| **Finding prefix** | FIN-001 …                                                                                          |
| **Audit date**     | 2026-08-10                                                                                         |
| **Method**         | Static review + concurrency / key lifecycle regression tests                                       |
| **Scope**          | Org wallet, manual credit, member budget, period limits, OpenRouter hard limits, reclaim, allocate |

---

## 1. Executive summary

AICO money surfaces already had strong foundations (CAS org allocate, platform-only manual credit, OpenRouter hard limits, renewal batch idempotency). This audit found **real overspend / invent-money bugs** around pending-period limits, reclaim retries, credit replay, and stale OpenRouter keys.

**Fixes shipped with this report** close FIN-001 … FIN-005 and rewrite the financial concurrency suite so it gates the current micro-USD API.

| Severity   |    Open | Fixed |
| ---------- | ------: | ----: |
| Critical   |       0 |     2 |
| High       |       0 |     2 |
| Medium     |       0 |     1 |
| Low / Info | several |     — |

---

## 2. Already well-protected (pre-existing)

| Area                                            | Evidence                                                    |
| ----------------------------------------------- | ----------------------------------------------------------- |
| Concurrent allocate cannot overspend org wallet | SQL CAS `UPDATE … WHERE wallet_balance_micro_usd >= amount` |
| Manual credit authZ                             | `platformProcedure` only                                    |
| Member self-budget                              | `requireOrgManager` on allocate / reclaim                   |
| Period renewal all-or-none                      | `aico_renewal_batches.batch_key` unique + CAS               |
| Money precision                                 | Integer micro-USD + Toman; topup max bounds                 |
| Tenant budget IDOR                              | TENANT-001/002/003 (prior audit)                            |

---

## 3. Findings

### FIN-001 — Pending-period reservation inflated OpenRouter spend limit

| Field                  | Value                                                                                                                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | Critical                                                                                                                                                                                                                                            |
| **Status**             | Fixed                                                                                                                                                                                                                                               |
| **Affected component** | `AicoOpenRouterKeyService.ensureMemberKey`, `allocateMemberCredit` pending branch                                                                                                                                                                   |
| **Description**        | `ensureMemberKey` used `reservedMicroUsd` (current + pending next-period funds) as the live OR `limit`. Members could spend next-cycle money immediately. Replacing a pending period also stacked into `reserved` without refunding the prior hold. |
| **Attack scenario**    | Allocate `$40` total, then queue `$30` monthly pending → OR limit `$70` while product intent is `$40` now.                                                                                                                                          |
| **Impact**             | Real OpenRouter overspend vs org wallet reservation model.                                                                                                                                                                                          |
| **Fix**                | OR limit = `periodAmountMicroUsd` only; pending replace refunds prior hold; reclaim adds `pendingPeriodAmountMicroUsd` back.                                                                                                                        |
| **Retest result**      | Pass — `aico.financialConcurrency.test.ts` pending suite + `aico.keyFailureInjection.test.ts` FIN-001                                                                                                                                               |

---

### FIN-002 — Double reclaim credits org wallet twice

| Field                  | Value                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | Critical                                                                                                                                                        |
| **Status**             | Fixed                                                                                                                                                           |
| **Affected component** | `OrganizationModel.reclaimMemberRemainingCredit`                                                                                                                |
| **Description**        | Reclaim always zeroed the budget and credited the org for `remainingMicroUsd` with no CAS on `renewal_status`. Concurrent revoke + outbox retry invented money. |
| **Attack scenario**    | Two reclaim paths with `$25` remaining → org wallet `+$50`.                                                                                                     |
| **Impact**             | Invented org USD; breaks conservation.                                                                                                                          |
| **Fix**                | CAS `WHERE renewal_status <> 'settled'`; second call is no-op (`transaction: null`).                                                                            |
| **Retest result**      | Pass — FIN-002 double reclaim test                                                                                                                              |

---

### FIN-003 — Manual credit / allocate not idempotent (replay)

| Field                  | Value                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | High                                                                                                                                                            |
| **Status**             | Fixed                                                                                                                                                           |
| **Affected component** | `addManualCredit`, `manualCreditUser`, `allocateMemberCredit`, platform/org routers                                                                             |
| **Description**        | Retried platform top-ups or allocate clicks created duplicate ledger rows and balances. Schema had unused `gateway_ref_id`.                                     |
| **Impact**             | Free money / double budgets on network retry or double-click.                                                                                                   |
| **Fix**                | Optional `idempotencyKey` → `gateway_ref_id`; unique partial index `wallet_transactions_gateway_ref_uidx` (migration `0143`); replay returns prior transaction. |
| **Retest result**      | Pass — FIN-003 idempotency tests                                                                                                                                |

---

### FIN-004 — OpenRouter key recreate left old key live

| Field                  | Value                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | High                                                                                                                                           |
| **Status**             | Fixed                                                                                                                                          |
| **Affected component** | `ensureUserKey` / `ensureMemberKey` recreate path                                                                                              |
| **Description**        | On 403/404 update failure, code created a new key without disabling/deleting the previous hash. Two live keys could spend against one deposit. |
| **Impact**             | Hard-limit model collapses → overspend.                                                                                                        |
| **Fix**                | `retireManagedKey` (disable + delete, best-effort) before recreate.                                                                            |
| **Retest result**      | Pass — FIN-004 keyFailureInjection test                                                                                                        |

---

### FIN-005 — Audit trail incomplete vs DoD (balance before/after)

| Field                  | Value                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | Medium                                                                                                                                                      |
| **Status**             | Fixed                                                                                                                                                       |
| **Affected component** | `wallet_transactions`, allocate / reclaim / credit / renewal ledger writers                                                                                 |
| **Description**        | Ledger rows had amount/actor/org/member/type/time but not previous/new balance required by the DoD.                                                         |
| **Recommendation**     | Add `balance_before_*` / `balance_after_*` columns and populate on every financial insert.                                                                  |
| **Fix**                | Migration `0144_aico_wallet_tx_balance_audit`; populate on org credit / allocate / reclaim, B2C `manualCreditUser`, and renewal period refund/renewal rows. |
| **Retest result**      | Pass — FIN-005 tests in `aico.financialConcurrency.test.ts` + `aicoBilling.manualCreditUser.test.ts`                                                        |

---

### FIN-006 … FIN-012 (lower priority / info)

| ID      | Severity | Status    | Summary                                                                                                         |
| ------- | -------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| FIN-006 | Low      | Mitigated | Allocate amount capped at router (`$100M` micro-USD) + model `MAX_SAFE_INTEGER`                                 |
| FIN-007 | Info     | Accepted  | Personal `user_wallets.balanceMicroUsd` not decremented locally — OR hard limit is SoT when key lifecycle holds |
| FIN-008 | Low      | Fixed     | Financial concurrency tests rewritten for micro-USD + FIN-001/002/003                                           |
| FIN-009 | Info     | Closed    | `addManualCredit` now requires `amountMicroUsd > 0`                                                             |
| FIN-010 | Info     | Accepted  | In-process key locks are single-node only                                                                       |
| FIN-011 | Info     | Accepted  | Trial request race mitigated by prod trial disable                                                              |
| FIN-012 | Info     | Accepted  | Platform-admin org-manager bypass (AUTHZ-002)                                                                   |

---

## 4. Definition of Done checklist

| Criterion                     | Status                                   |
| ----------------------------- | ---------------------------------------- |
| Race condition tested         | ✅ CAS allocate + rewritten suite        |
| Double spend tested           | ✅ Parallel allocate + double reclaim    |
| Concurrent requests tested    | ✅ Parallel allocate / server-db barrier |
| Balance manipulation reviewed | ✅ AuthZ + reclaim CAS + idempotency     |
| Precision reviewed            | ✅ micro-USD integers                    |
| Replay attack tested          | ✅ idempotency keys                      |
| Audit trail reviewed          | ✅ FIN-005 balance before/after columns  |

---

## 5. Key files

| Path                                                                       | Role                                 |
| -------------------------------------------------------------------------- | ------------------------------------ |
| `packages/database/src/models/organization.ts`                             | allocate / reclaim / addManualCredit |
| `packages/database/src/models/aicoBilling.ts`                              | B2C manual credit                    |
| `apps/server/src/services/openrouter/keyService.ts`                        | OR limits / reclaim / key retire     |
| `apps/server/src/routers/lambda/organization.ts`                           | allocate API + security event        |
| `apps/server/src/routers/lambda/platformAdmin.ts`                          | manual credit APIs                   |
| `packages/database/migrations/0143_aico_wallet_tx_gateway_ref_uidx.sql`    | idempotency unique index             |
| `packages/database/migrations/0144_aico_wallet_tx_balance_audit.sql`       | balance before/after audit columns   |
| `packages/database/src/models/__tests__/aico.financialConcurrency.test.ts` | money race gates                     |
| `apps/server/src/services/openrouter/aico.keyFailureInjection.test.ts`     | FIN-001 / FIN-004                    |

---

_Retest file (if needed): `security-audit-reports/phase-02-business-logic/04-wallet-budget-security-retest.md`_
