# Aico Release Blockers (Phase 3)

**Verdict:** NO-GO  
**Commit:** `b357039491bc5d8c4f027ec8a64139e2a1c5abc3`  
**Date:** 2026-07-30  

Any single P0 below is sufficient to refuse release. All listed items were **reproduced** on the current tree (product code unchanged since Phase 1/2).

---

## BLK-001 — Ungated mock B2C top-up (AICO-P1-001)

| Field | Value |
|---|---|
| Severity | **P0** |
| Executable reproduction | `aicoBillingRouter.createCaller(authed).mockTopup({ amountToman: 100000 })` under production-like env → credits wallet; Phase 3 Env C expects FORBIDDEN |
| Affected users | Any authenticated user |
| Financial/security exposure | Arbitrary USD mint → real OpenRouter spend if management key live |
| Evidence | `aico.rbacIdor.test.ts`, `aico.phase3.releaseGate.test.ts` FAIL; UI `src/features/AicoWallet/index.tsx` ungated |
| Minimum safe remediation | Delete or hard-forbid unless `AICO_ALLOW_MOCK_TOPUP=1` **and** non-production; hide UI |
| Regression test | Phase 2/3 mockTopup gate tests must PASS (FORBIDDEN, no balance change) |
| Owner area | `apps/server/.../aicoBilling.ts`, `AicoWallet` |
| Retest criteria | Production NODE_ENV + no allow flag → FORBIDDEN; wallet unchanged |

---

## BLK-002 — Ungated mock org top-up (AICO-P1-002)

| Field | Value |
|---|---|
| Severity | **P0** |
| Executable reproduction | Org owner `mockOrgTopup({ amountToman, orgId })` credits org USD |
| Affected users | Org owners/admins |
| Exposure | Org-scale arbitrary credit + member allocation |
| Evidence | `aico.rbacIdor.test.ts` FAIL; static probe `mockOrgHasProdGate: false` |
| Minimum remediation | Remove or platform-admin-only; no self-serve in MVP |
| Regression test | Owner mockOrgTopup FORBIDDEN; platform `addManualCredit` still works |
| Owner area | `organization` router + OrgAdmin UI |
| Retest | Same as BLK-001 for org wallet |

---

## BLK-003 — Trial falls through to shared env OpenRouter key (AICO-P1-003)

| Field | Value |
|---|---|
| Severity | **P0** |
| Executable reproduction | Activate trial; `AicoChatGuard.resolveManagedApiKey(userId)` returns `null` → runtime uses `OPENROUTER_API_KEY` |
| Affected users | All trial users without personal/org key |
| Exposure | Unbounded platform spend; amplifies quota TOCTOU |
| Evidence | Phase 2/3 guard tests FAIL (expected non-null) |
| Minimum remediation | Fail closed without managed limited trial key; never env fallthrough |
| Regression test | Trial without wallet key must throw / deny chat; no env key use |
| Owner area | `chatGuard.ts`, `ModelRuntime`, chat route |
| Retest | Proxy capture shows no shared-key traffic for trial |

---

## BLK-004 — OpenRouter Management silent mock (AICO-P1-004)

| Field | Value |
|---|---|
| Severity | **P0** |
| Executable reproduction | Unset `OPENROUTER_MANAGEMENT_API_KEY`, `NODE_ENV=production` → `MockOpenRouterManagementClient` |
| Affected users | All managed-key users; operators |
| Exposure | False isolation; combined with env chat key → shared spend |
| Evidence | Phase 2/3 factory tests FAIL; `managementSilentMock: true` |
| Minimum remediation | Throw / fail health unless mock **and** non-prod |
| Regression test | Production missing key throws; mock flag ignored in production |
| Owner area | `management.ts`, `packages/env/src/aico.ts` |
| Retest | Env C matrix all fail-closed |

---

## BLK-005 — Concurrent allocate overspend (AICO-P1-005 / P2-N01)

| Field | Value |
|---|---|
| Severity | **P1 (release-blocking)** |
| Executable reproduction | Dual unchecked debit 80+80 on 100 → balance **-60**; NaN allocate accepted |
| Affected users | Orgs with concurrent managers |
| Exposure | Over-allocation beyond paid credit |
| Evidence | Phase 2/3 financial tests FAIL |
| Minimum remediation | `UPDATE … WHERE balance >= amt RETURNING` or `FOR UPDATE`; reject non-finite |
| Regression test | Stale-read + parallel allocate never negative; NaN throws |
| Owner area | `OrganizationModel.allocateMemberCredit` |
| Retest | 20× parallel on real Postgres |

---

## BLK-006 — Suspended org still spendable (AICO-P1-006 / P2-N02)

| Field | Value |
|---|---|
| Severity | **P1 (release-blocking)** |
| Executable reproduction | `setOrganizationStatus(id,'suspended')`; org still in `listForUser`; allocate/accept invite still work |
| Affected users | Suspended tenants |
| Exposure | Non-pay / abuse continues |
| Evidence | invitationLifecycle + phase3 journeys FAIL |
| Minimum remediation | Filter status; deny allocate/chat/resolve; disable all member OR keys on suspend |
| Regression test | After suspend: hidden, allocate/chat deny, OR keys disabled |
| Owner area | org model, keyService, chatGuard, platformAdmin |
| Retest | Journey 2 suspend steps green |

---

## BLK-007 — removeMember leaves OR key live (AICO-P1-007)

| Field | Value |
|---|---|
| Severity | **P1 (release-blocking)** |
| Executable reproduction | Allocate + set key id; `removeMember`; `openrouterKeyId` remains |
| Affected users | Removed/disabled members |
| Exposure | Continued org-funded spend via retained key |
| Evidence | Phase 2/3 FAIL |
| Minimum remediation | Disable/delete OR key + clear DB fields in same flow |
| Regression test | Key id null + OR disabled after remove |
| Owner area | `removeMember`, keyService |
| Retest | Journey 2 remove steps |

---

## BLK-008 — Multi-org billing context missing (AICO-P1-008)

| Field | Value |
|---|---|
| Severity | **P1 (release-blocking)** |
| Executable reproduction | User in two orgs; no `resolveBillingContext` API; first-match resolve |
| Affected users | Multi-org users |
| Exposure | Wrong org charged |
| Evidence | multiOrg + phase3 FAIL (`hasExplicit === false`) |
| Minimum remediation | Require explicit org/billing context on managed chat |
| Regression test | Ambiguous state rejects; explicit context bills correct org |
| Owner area | keyService, chat APIs, SPA |
| Retest | Journey 2 multi-org |

---

## BLK-009 — Unguarded alternate model paths (AICO-P1-009 / P1-015)

| Field | Value |
|---|---|
| Severity | **P1 (release-blocking)** |
| Executable reproduction | Static scan: **23** `initModelRuntimeFromDB` sites lack `assertModelAllowed`; chat route lacks `recordUsage`/`syncMemberUsage` |
| Affected users | Agents/embeddings/image/etc. users |
| Exposure | Policy/quota bypass; no usage ledger |
| Evidence | chatBypass + phase3 J6 FAIL |
| Minimum remediation | Mandatory pre-hook in runtime init; wire usage |
| Regression test | Offender list empty; usage rows after chat |
| Owner area | ModelRuntime + all callers |
| Retest | Journey 6 |

---

## BLK-010 — Trial quota TOCTOU + fingerprint uniqueness (AICO-P1-010 / 013)

| Field | Value |
|---|---|
| Severity | **P1 (release-blocking)** |
| Executable reproduction | Parallel `incrementTrialRequest` → count 3>1; dual `activateTrial` same phone → 2 rows; no UNIQUE |
| Affected users | Trial users / abusers |
| Exposure | Multi-request + multi-trial abuse |
| Evidence | trialAbuse + phase3 FAIL |
| Minimum remediation | Atomic reserve `WHERE count < max`; `UNIQUE(phone_fingerprint)`; normalize phone |
| Regression test | Parallel activate/increment → single success / count≤max |
| Owner area | aicoBilling schema+model |
| Retest | Journey 1 concurrent + recreate |

---

## BLK-011 — ensureKey orphans + zero-budget floor (AICO-P1-011 / 016)

| Field | Value |
|---|---|
| Severity | **P1 (release-blocking)** |
| Executable reproduction | Parallel `ensureUserKey` → 2 OR keys; zero budget still creates `.01` key |
| Affected users | All provisioned users/members |
| Exposure | Master account leak; unexpected spendable keys |
| Evidence | keyFailureInjection FAIL |
| Minimum remediation | Lock wallet/budget row; reconcile by name; refuse create at limit≤0 |
| Regression test | Parallel ensure → 1 key; zero budget → 0 keys |
| Owner area | `AicoOpenRouterKeyService` |
| Retest | Journey 4/5 |

---

## BLK-012 — Migration 0132 unsafe + SMS debug fail-open (AICO-P1-012 / 014)

| Field | Value |
|---|---|
| Severity | **P1 (release-blocking)** |
| Executable reproduction | `0132` adds `user_id NOT NULL` without DEFAULT; missing Kavenegar → `DebugSmsService` even under production NODE_ENV |
| Affected users | Upgrading deployments; all phone OTP users |
| Exposure | Migration outage; OTP bypass → trial abuse chain |
| Evidence | multiOrgMigration + phase3 Env C FAIL |
| Minimum remediation | Backfill migration; production SMS fail-closed |
| Regression test | Env B upgrade succeeds; Env C SMS throws |
| Owner area | migrations, sms impls |
| Retest | Env B + Env C |

---

## BLK-013 — Malformed OR response persistence gap (AICO-P3-N01)

| Field | Value |
|---|---|
| Severity | **P1** |
| Executable reproduction | Controllable OR `malformed` mode during `ensureUserKey` — Phase 3 expected reject without spendable key persist |
| Affected users | Users topping up during OR glitches |
| Exposure | Corrupt key state / confusing spend path |
| Evidence | `aico.phase3.releaseGate.test.ts` FAIL |
| Minimum remediation | Validate OR payload schema before encrypt/persist |
| Regression test | Malformed create never sets `openrouterKeyId` |
| Owner area | keyService |
| Retest | Journey 4 malformed case PASS |

---

## Non-blocking but tracked P2 (must not be ignored)

Invite phone normalize (022), org create without phone verify (023), money wire numbers (018), Persian digits (020), fingerprint variants (021), invite token leak (026), SPA loader RBAC (027), stub master balance (024).

---

## Top five blockers (priority)

1. BLK-001 mock B2C top-up  
2. BLK-002 mock org top-up  
3. BLK-003 trial env-key fallthrough  
4. BLK-004 silent OR management mock  
5. BLK-005 concurrent allocate overspend  
