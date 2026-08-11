# OpenRouter Integration Security Audit

| Field              | Value                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| **Plane**          | [AICO-106](https://plane.panafor.com/panaforai/browse/AICO-106/)                                        |
| **Phase**          | Phase 2 — Business Logic & Multi-Tenancy Security                                                       |
| **Finding prefix** | OR-001 …                                                                                                |
| **Audit date**     | 2026-08-11                                                                                              |
| **Method**         | Static review + key lifecycle / outbox / managed-policy regression tests                                |
| **Scope**          | Master management key, per-member/user OpenRouter keys, model allow-list, param tamper, failure + retry |

---

## 1. Executive summary

OpenRouter spend for Aico is gated by **per-user / per-member keys** with hard limits, while the **master management key** must live only on the control plane. Prior work (control-plane split, FIN-001/FIN-004, TENANT-001, managed chat policy) already closed most spend-bypass paths.

This audit found remaining gaps: soft-delete never disabled personal keys (`disable_user_key` unsupported), create→DB failure left **orphan spendable keys**, managed authorize skipped the model allow-list when `modelId` was omitted, member remove waited on async outbox before OR disable, and non-prod product processes could still embed the management key.

**Fixes shipped with this report** close OR-001 … OR-005 and OR-008.

| Severity   | Open | Fixed | Accepted |
| ---------- | ---: | ----: | -------: |
| Critical   |    0 |     1 |        0 |
| High       |    0 |     3 |        0 |
| Medium     |    0 |     1 |        2 |
| Low / Info |    0 |     1 |        1 |

---

## 2. Already well-protected (pre-existing / prior audits)

| Area                                            | Evidence                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Master key not in SPA / `NEXT_PUBLIC_*`         | Server-only `packages/env/src/aico.ts`; wallet APIs expose `hasManagedKey` only                |
| Master key product↔control-plane split          | `RemoteOpenRouterManagementClient` + service token; CP `openrouterInternal.ts`                 |
| Chat managed providers fail closed              | `AicoManagedPolicy` + `DIRECT_PROVIDER_NOT_ALLOWED` for BYOK chat                              |
| Org membership / foreign `organizationId`       | Authorize resolves **caller** membership; foreign org → `ORG_MEMBERSHIP_REQUIRED`              |
| Client cannot set `memberId` / `budget` / `key` | Not in `AicoBillingContext`; keys decrypted server-side only                                   |
| FIN-001 current-cycle OR limit                  | `currentCycleLimitMicro` / wallet-budget audit                                                 |
| FIN-004 retire before recreate                  | `retireManagedKey`                                                                             |
| TENANT-001 reclaim scoping                      | `reclaimMemberKey({ orgId, orgMemberId })`                                                     |
| Org suspend / delete disables member keys       | `disableAllOrgMemberKeys`                                                                      |
| Allocate / reclaim money races                  | FIN-002 / FIN-003 (wallet audit)                                                               |
| Non-chat managed call without billing           | Fail closed (`BILLING_CONTEXT_REQUIRED`) — prevents spend bypass (OR-004 accepted product gap) |

---

## 3. Findings

### OR-001 — Soft-delete outbox `disable_user_key` never ran

| Field                  | Value                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Severity**           | Critical                                                                                                                                                                                                                             |
| **Status**             | Fixed                                                                                                                                                                                                                                |
| **Affected component** | `AicoSoftDeleteService.softDeleteUser`, `processKeyOutbox` / `runOutboxAction`                                                                                                                                                       |
| **Description**        | Soft-delete enqueued `disable_user_key`, but the outbox switch only handled `disable_member_key` / `reclaim_member` → `UNSUPPORTED_OUTBOX_ACTION`. Personal OR keys stayed enabled after account delete (wallet frozen in-app only). |
| **Attack scenario**    | User soft-deletes account; previously issued personal key (or cached client) continues spending against the master OpenRouter account.                                                                                               |
| **Impact**             | Unbounded spend after account deletion for B2C keys.                                                                                                                                                                                 |
| **Recommendation**     | Handle `disable_user_key` → `keyService.disableUserKey(userId)`.                                                                                                                                                                     |
| **Fix**                | Added `case 'disable_user_key'` in `runOutboxAction`.                                                                                                                                                                                |
| **Retest result**      | Pass — `keyOutbox.disableUserKey.test.ts`                                                                                                                                                                                            |

---

### OR-002 — `createKey` then DB persist failure left orphan spendable key

| Field                  | Value                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | High                                                                                                                                                    |
| **Status**             | Fixed                                                                                                                                                   |
| **Affected component** | `AicoOpenRouterKeyService.ensureUserKey` / `ensureTrialKey` / `ensureMemberKey`                                                                         |
| **Description**        | OpenRouter `createKey` succeeded, then DB ciphertext write failed. The live key was untracked and remained spendable. Proven by failure-injection test. |
| **Attack scenario**    | Transient DB error during provisioning → orphan key on master account; retries mint more orphans.                                                       |
| **Impact**             | Master-account spend outside Aico ledger / hard-limit bookkeeping.                                                                                      |
| **Recommendation**     | On persist failure, best-effort disable+delete (same as FIN-004 `retireManagedKey`).                                                                    |
| **Fix**                | `createAndPersistUserKey` + member create path wrap persist in try/catch and `retireManagedKey`.                                                        |
| **Retest result**      | Pass — `aico.keyFailureInjection.test.ts` OR-002                                                                                                        |

---

### OR-003 — Managed authorize skipped model allow-list when `modelId` omitted

| Field                  | Value                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | High                                                                                                                                               |
| **Status**             | Fixed                                                                                                                                              |
| **Affected component** | `AicoManagedPolicy.authorize`                                                                                                                      |
| **Description**        | `assertModelAllowed` ran only `if (params.modelId)`. Callers that injected a managed key without `modelId` bypassed team/trial model restrictions. |
| **Attack scenario**    | Alternate / future runtime path with billing context but no model → forbidden model callable with member key.                                      |
| **Impact**             | Model-restriction DoD bypass.                                                                                                                      |
| **Recommendation**     | Require non-empty `modelId` for all managed authorize calls.                                                                                       |
| **Fix**                | Throw `MODEL_ID_REQUIRED` before key decrypt / injection.                                                                                          |
| **Retest result**      | Pass — `managedPolicy.test.ts` OR-003                                                                                                              |

---

### OR-004 — Non-chat LLM transports lack billing + model wiring

| Field                  | Value                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | Medium (product completeness)                                                                                                                                                    |
| **Status**             | Accepted Risk (fail-closed)                                                                                                                                                      |
| **Affected component** | e.g. `ServerLLMTransport.createModelRuntime` and other agent/system init sites without `billingContext`                                                                          |
| **Description**        | Managed providers refuse to run without billing context (`BILLING_CONTEXT_REQUIRED`). This **blocks spend bypass** but also blocks funded agent use of managed keys until wired. |
| **Impact**             | Agents cannot use org/personal managed OpenRouter keys yet; no silent fallthrough to env/BYOK for managed providers.                                                             |
| **Recommendation**     | Follow-up product work: thread `AicoBillingContext` + `modelId` into agent transports.                                                                                           |
| **Retest result**      | N/A — documented Accepted Risk for AICO-106 scope                                                                                                                                |

---

### OR-005 — Member remove only async-disabled OpenRouter key

| Field                  | Value                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Severity**           | High                                                                                                                     |
| **Status**             | Fixed                                                                                                                    |
| **Affected component** | `organization.removeMember` router                                                                                       |
| **Description**        | Removal set `revocation_pending` and enqueued `reclaim_member`, but OR key stayed enabled until cron drained the outbox. |
| **Attack scenario**    | Remove member; until `process-key-outbox` runs, cached key can still spend.                                              |
| **Impact**             | Delayed revoke window vs DoD “member delete revokes key”.                                                                |
| **Recommendation**     | Best-effort sync `disableMemberKey` on remove; keep outbox for settlement retry.                                         |
| **Fix**                | Sync disable before outbox insert; outbox still performs reclaim + finalize.                                             |
| **Retest result**      | Pass (static + existing reclaim outbox path); sync call best-effort with warn log                                        |

---

### OR-006 — Multi-instance createKey races

| Field                  | Value                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | Medium                                                                                                                    |
| **Status**             | Accepted Risk                                                                                                             |
| **Affected component** | `runExclusive` in-process lock in `keyService.ts`                                                                         |
| **Description**        | Single-node mutex does not prevent two replicas from both calling `createKey`. OR-002 compensation reduces orphan damage. |
| **Recommendation**     | DB advisory lock / unique claim on provisioning (follow-up).                                                              |
| **Retest result**      | N/A — Accepted (aligned with FIN-010)                                                                                     |

---

### OR-007 — Master OpenRouter prepaid balance unknowable

| Field                  | Value                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | Medium (ops)                                                                                                                                        |
| **Status**             | Accepted Risk                                                                                                                                       |
| **Affected component** | `masterMonitor.ts` (`availableCreditMicroUsd: null`)                                                                                                |
| **Description**        | OpenRouter does not expose a reliable remaining prepaid balance API used by Aico. Monitor heartbeats / staleness alerts exist; no invented balance. |
| **Recommendation**     | Keep Accepted; rely on OR dashboard / billing webhook if available later.                                                                           |
| **Retest result**      | N/A — Accepted                                                                                                                                      |

---

### OR-008 — Non-prod product could embed management key

| Field                  | Value                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | Low                                                                                                                                                        |
| **Status**             | Fixed                                                                                                                                                      |
| **Affected component** | `createOpenRouterManagementClient`                                                                                                                         |
| **Description**        | Management key rejection on product previously gated on `NODE_ENV === 'production'` only. Staging / misconfigured local product could hold the master key. |
| **Impact**             | Key leakage surface on non-prod product processes.                                                                                                         |
| **Fix**                | Reject `OPENROUTER_MANAGEMENT_API_KEY` on any process where `!AICO_IS_CONTROL_PLANE`.                                                                      |
| **Retest result**      | Pass — `remoteManagementClient.test.ts` OR-008                                                                                                             |

---

## 4. Definition of Done checklist

| Criterion                         | Status                                                                 |
| --------------------------------- | ---------------------------------------------------------------------- |
| Master Key leakage reviewed       | ✅ SPA / API / logs / env / CP split + OR-008                          |
| Per-member Key lifecycle reviewed | ✅ create/budget/model/revoke; OR-001 soft-delete; OR-005 remove sync  |
| Budget bypass tested              | ✅ Prior FIN-\* + managed policy; OR keys hard-limited                 |
| Model bypass tested               | ✅ Chat path + OR-003 required `modelId`                               |
| Failure Handling reviewed         | ✅ OR-002 orphan compensate; prior fail-closed mock refuse in prod     |
| Retry behavior reviewed           | ✅ Outbox CAS; FIN-002/003 money idempotency; chat SoT = OR hard limit |

---

## 5. Parameter manipulation matrix

| Parameter        | Client-controllable? | Server behavior                                          |
| ---------------- | -------------------- | -------------------------------------------------------- |
| `model`          | Yes (request)        | `assertModelAllowed` after OR-003 requires `modelId`     |
| `provider`       | Yes (route)          | Non-managed chat rejected; managed forced through policy |
| `memberId`       | No                   | Derived from caller membership                           |
| `organizationId` | In billing context   | Must match **active** membership of caller               |
| `budget`         | No                   | DB period/reserved amounts only                          |
| `key`            | No                   | Ciphertext decrypt server-side; never returned to SPA    |

---

## 6. Failure / retry notes

| Scenario                | Behavior                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| Timeout / network / 5xx | Management client throws; no silent mock in prod product                                      |
| Invalid API key         | Chat fails closed (`MANAGED_KEY_*` / runtime error)                                           |
| OR low / zero balance   | OR-007 Accepted — no invented balance; key hard limits still enforce member/user spend        |
| Partial create+DB fail  | OR-002 retires orphan                                                                         |
| Duplicate / retry money | FIN-002/003 reclaim + idempotency keys                                                        |
| Chat retry              | Second successful completion is a second OR charge (expected); Aico wallet not double-debited |

---

## 7. Key files

| Path                                                                   | Role                                         |
| ---------------------------------------------------------------------- | -------------------------------------------- |
| `apps/server/src/services/aico/renewalScheduler.ts`                    | Outbox `disable_user_key` (OR-001)           |
| `apps/server/src/services/openrouter/keyService.ts`                    | Orphan retire on persist fail (OR-002)       |
| `apps/server/src/services/aico/managedPolicy.ts`                       | Require `modelId` (OR-003)                   |
| `apps/server/src/routers/lambda/organization.ts`                       | Sync disable on remove (OR-005)              |
| `apps/server/src/services/openrouter/management.ts`                    | Product never embeds management key (OR-008) |
| `apps/server/src/services/aico/keyOutbox.disableUserKey.test.ts`       | OR-001 regression                            |
| `apps/server/src/services/openrouter/aico.keyFailureInjection.test.ts` | OR-002 regression                            |
| `apps/server/src/services/aico/managedPolicy.test.ts`                  | OR-003 regression                            |
| `apps/server/src/services/openrouter/remoteManagementClient.test.ts`   | OR-008 regression                            |

---

## 8. Explicitly not re-opened

Recorded as **Pass / prior** — do not reopen as new OR work: **FIN-001**, **FIN-004**, **TENANT-001**, control-plane master-key split, chat BYOK deny for managed providers.

---

_Retest file (if needed): `security-audit-reports/phase-02-business-logic/05-openrouter-integration-security-retest.md`_
