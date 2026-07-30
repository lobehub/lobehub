# Aico Phase 2 Adversarial Test Report

**Role:** Senior test engineer (adversarial / concurrency / financial / AuthZ)  
**Date:** 2026-07-30  
**Baseline commit:** `b357039491bc5d8c4f027ec8a64139e2a1c5abc3` (`canary`)  
**Seed label:** `phase2-2026-07-30`  
**Product code modified:** **None** (tests + this report only)

---

## Final Phase 2 verdict

# **NO-GO — defects confirmed by failing regression harnesses**

Phase 2 did not attempt to make the product green. It added invariant-named tests that assert **safe** behavior. **31 tests fail because the implementation violates those invariants**, reproducing Phase 1 P0/P1 findings with executable evidence. Two concurrency cases remain blocked without `TEST_SERVER_DB=1` + real Postgres (Docker unavailable; remote `DATABASE_URL` host unreachable).

---

## 1. Baseline results

| Item | Value |
|---|---|
| Branch | `canary` (tracks `origin/canary`) |
| HEAD | `b357039491` — Phase 1 better auth phone (#10) |
| Working tree (start) | Clean except untracked `AICO_PHASE1_AUDIT.md` |
| Runtime | Node `v24.15.0`, bun `1.3.14`, pnpm `10.33.0` |
| `DATABASE_TEST_URL` | **UNSET** |
| Local Postgres ports 5432/5433/5434 | **Closed** |
| Docker | **Not installed / not on PATH** |
| Remote `.env` `DATABASE_URL` host | TCP **timeout** (not used) |
| Test DB engine used | **PGlite** via `getTestDB()` (default client-db) |
| `KEY_VAULTS_SECRET` for key tests | Valid 32-byte base64 (`MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=`) |
| `AICO_IMPLEMENTATION_REVIEW.md` | Still **missing** (Phase 1 note) |

### Existing focused tests (unchanged code) — all green

| Command | Result | Timing |
|---|---|---|
| `cd packages/database && bunx vitest run --silent='passed-only' src/models/__tests__/aicoBilling.test.ts` | **2/2 pass** | ~40.5s |
| `cd packages/database && bunx vitest run --silent='passed-only' src/models/__tests__/organization.test.ts` | **10/10 pass** | ~15.0s |
| `bunx vitest run --silent='passed-only' apps/server/src/services/aico/chatGuard.test.ts apps/server/src/services/openrouter/management.test.ts` | **4/4 pass** | ~38.3s |
| `bunx vitest run --silent='passed-only' src/libs/better-auth/phone.test.ts` | **8/8 pass** | ~6.2s |

**Baseline total:** 24 passed / 0 failed.

---

## 2. Test matrix (summary)

| Domain | Invariant | Attack / failure | Level | Expected | Actual | Finding |
|---|---|---|---|---|---|---|
| AuthZ / money | Mock B2C top-up forbidden in prod | Any authed `mockTopup` | Router | FORBIDDEN / no credit | Credits wallet; gate absent | AICO-P1-001 |
| AuthZ / money | Mock org top-up forbidden | Org owner `mockOrgTopup` | Router | Deny | Credits org | AICO-P1-002 |
| Trial / spend | No env-key fallthrough | Trial active, no managed key | Guard | Deny or limited key | `resolveManagedApiKey` → `null` | AICO-P1-003 |
| Prod config | No silent OR management mock | Missing mgmt key | Unit | Throw / fail closed | `MockOpenRouterManagementClient` | AICO-P1-004 |
| Finance race | No overspend | Stale-read 80+80 on 100 | Model | Balance ≥ 0; ≤1 success | Balance **-60** | AICO-P1-005 |
| Finance | Reject NaN amounts | `amountUsd: NaN` | Model | Throw; balance unchanged | Mutates / non-finite | AICO-P1-005/017 |
| Org lifecycle | Suspended not spendable | Suspend then list/allocate | Model | Hidden + deny | Still listed | AICO-P1-006 |
| Org lifecycle | Suspended invite accept deny | Accept after suspend | Model | Reject | Accepts | AICO-P1-006 |
| Member lifecycle | Key cleared on remove | removeMember | Model | `openrouterKeyId` null | Key id remains | AICO-P1-007 |
| Multi-org | Explicit billing context | Two org keys | Model | Explicit API required | Silent first-match | AICO-P1-008 |
| Chat policy | All runtime paths guarded | Scan `initModelRuntimeFromDB` | Static probe | 0 unguarded | **23** offenders | AICO-P1-009 |
| Trial quota | Atomic maxRequests | Parallel increments | Model | count ≤ max | count **3** > 1 | AICO-P1-010 |
| Key provision | Idempotent create | Parallel `ensureUserKey` | Service | 1 OR key | **2** keys (orphan) | AICO-P1-011 |
| Migration | Safe NOT NULL add | 0132 SQL + scratch ALTER | Migration | DEFAULT/backfill | No DEFAULT; scratch fails as predicted | AICO-P1-012 |
| Trial abuse | Unique phone fingerprint | Dual insert / parallel activate | Model+schema | 1 row / UNIQUE | **2 rows**; second insert OK | AICO-P1-013 |
| SMS | Prod fail-closed | No Kavenegar | Unit | No Debug SMS | `DebugSmsService` | AICO-P1-014 |
| Usage | Chat writes usage | Chat route source | Static | `recordUsage`/`syncMemberUsage` | Absent | AICO-P1-015 |
| Budget | Zero budget → no key | `ensureMemberKey` limit 0 | Service | 0 keys | Creates key (**$0.01** floor) | AICO-P1-016 |
| Money types | Wire strings | Model/router wallet | Contract | `typeof === 'string'` | `number` | AICO-P1-018 |
| Phone | Persian/Arabic digits | Normalize | Unit | E.164 | `null` | AICO-P1-020 |
| Fingerprint | Canonical variants | 6 formats | Unit | 1 fingerprint | **6** distinct | AICO-P1-021 |
| Invite | Cross-format phone accept | E.164 invite vs `09…` user | Model | Accept | `INVITE_IDENTIFIER_MISMATCH` | AICO-P1-022 |
| Org create | Phone verified required | Unverified create | Router | Reject | Org created | AICO-P1-023 |
| Secrets | List invites omit token | `listMembers` | Router | No raw token | Token present | AICO-P1-026 |
| IDOR | Member/stranger deny | Cross-org IDs | Router | FORBIDDEN | FORBIDDEN (pass) | — |
| Platform RBAC | Non-admin deny | platformAdmin.* | Router | FORBIDDEN | FORBIDDEN (pass) | — |
| Split-brain | OR fail after credit | HTTP 500 createKey | Service | Documented split | Credit kept, no key id (pass documenting) | — |
| Split-brain | OR ok, DB key write fail | Injected DB fail | Service | Orphan OR key | Orphan confirmed (pass documenting) | — |

---

## 3. Tests created

| File | Suite focus |
|---|---|
| `packages/database/src/models/__tests__/aico.phase2.helpers.ts` | Shared cleanup/seed |
| `packages/database/src/models/__tests__/aico.financialConcurrency.test.ts` | Allocate races, NaN, FX conservation, money wire |
| `packages/database/src/models/__tests__/aico.trialAbuse.test.ts` | Trial race, fingerprint, quota TOCTOU, blocklist |
| `packages/database/src/models/__tests__/aico.invitationLifecycle.test.ts` | Invite security + org lifecycle |
| `packages/database/src/models/__tests__/aico.multiOrgMigration.test.ts` | Multi-org context + migration SQL probes |
| `apps/server/src/services/openrouter/aico.keyFailureInjection.test.ts` | Controllable OpenRouter fake + key split-brain |
| `apps/server/src/services/aico/aico.chatBypassProduction.test.ts` | Chat bypass scan, trial fallthrough, SMS/OR prod gates |
| `apps/server/src/routers/lambda/__tests__/aico.rbacIdor.test.ts` | tRPC RBAC/IDOR + mock top-up gates |
| `src/libs/better-auth/phone.aico.phase2.test.ts` | Persian/Arabic/bare-CC normalize |

---

## 4. Commands executed

```bash
# Baseline (see §1)

# Phase 2 database package (PGlite)
cd packages/database
# KEY_VAULTS_SECRET not required for these
bunx vitest run \
  src/models/__tests__/aico.financialConcurrency.test.ts \
  src/models/__tests__/aico.trialAbuse.test.ts \
  src/models/__tests__/aico.invitationLifecycle.test.ts \
  src/models/__tests__/aico.multiOrgMigration.test.ts
# Result: exit 1 | 18 passed | 14 failed | 2 skipped | ~41s | seed phase2-2026-07-30

# Phase 2 server + phone
cd <repo-root>
set KEY_VAULTS_SECRET=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=
bunx vitest run \
  apps/server/src/services/openrouter/aico.keyFailureInjection.test.ts \
  apps/server/src/services/aico/aico.chatBypassProduction.test.ts \
  apps/server/src/routers/lambda/__tests__/aico.rbacIdor.test.ts \
  src/libs/better-auth/phone.aico.phase2.test.ts
# Result: exit 1 | 15 passed | 17 failed | ~37s | seed phase2-2026-07-30
```

Server-db barrier tests are present but **skipped** (`it.skipIf(!isServerDb())`) because `TEST_SERVER_DB` / `DATABASE_TEST_URL` unavailable.

---

## 5. Passed tests (selected)

These pass because the **safe** behavior already holds, or because the test documents a recoverable split-brain without asserting an unimplemented fix:

- Serial allocate conservation / many parallel allocate non-negative under PGlite serialization  
- Invite expiry / reuse / wrong email / revoke / malformed token  
- Default team delete blocked; last-owner demotion blocked  
- Scratch-table NOT NULL add without default **fails** (proves PG hazard class)  
- Migration lacks UNIQUE phone fingerprint index (static pass asserting absence)  
- `recordUsage` can write when called manually  
- Member/stranger/platform IDOR denies on sensitive org/platform procedures  
- Removed admin cannot manage  
- Team allow-list denies disallowed model; trial alias deny  
- OR HTTP 500 after credit → wallet credited, no key id  
- OR create + DB key write fail → orphan key on fake OR, no DB key id  
- `ensureUserKey` result omits plaintext  
- Wallet router source does not return key ciphertext fields  
- `tomanToUsd` rejects non-positive FX  
- ASCII `09…` / `+98…` phone normalize (existing happy path)

---

## 6. Failing tests that confirm defects

For each: **reproducibility ≥ 2** on this machine unless noted; **blocks release** per Phase 1 severity.

### P0

| Test | Finding | Failure summary | Expected invariant | Actual | Blocks |
|---|---|---|---|---|---|
| RBAC `mockTopup` gate | AICO-P1-001 | `gatedInProduction === false`; credit succeeds | Prod-forbidden | Authed mint works | Yes |
| RBAC `mockOrgTopup` gate | AICO-P1-002 | same | Prod-forbidden / platform-only | Org owner mints | Yes |
| Trial resolve key | AICO-P1-003 | `expected null not to be null` | Managed/deny key | `null` → env fallthrough | Yes |
| OR mock without key (×2 suites) | AICO-P1-004 | Mock client selected | Fail closed | Silent mock | Yes |
| SMS Debug in “production” | AICO-P1-014 | `DebugSmsService` | Fail closed | Debug | Yes |

### P1

| Test | Finding | Failure summary | Expected | Actual | Blocks |
|---|---|---|---|---|---|
| Stale-read allocate | AICO-P1-005 | balance **-60** | ≥ 0; CAS | Overspend | Yes |
| NaN allocate | AICO-P1-005/017 | `threw === false` / non-finite | Reject | Accepts NaN path | Yes |
| Suspend list | AICO-P1-006 | org still in `listForUser` | Hidden | Listed | Yes |
| Suspend invite accept | AICO-P1-006 | accept resolves | Reject | Accepts | Yes |
| removeMember key | AICO-P1-007 | key id `'or-key-alive'` | Cleared | Remains | Yes |
| Explicit billing API | AICO-P1-008 | `hasExplicitBillingContextApi` false | Required | Missing | Yes |
| Chat path scan | AICO-P1-009 | **23** unguarded call sites | 0 | 23 | Yes |
| Usage wiring | AICO-P1-015 | no `recordUsage`/`syncMemberUsage` in chat route | Wired | Absent | Yes |
| Parallel trial increment | AICO-P1-010 | count **3** > max **1** | ≤ max | Exceeds | Yes |
| Stale trial check | AICO-P1-010 | count **2** > 1 | ≤ max | Exceeds | Yes |
| Parallel ensureUserKey | AICO-P1-011 | OR keys **2** ≠ 1 | One key | Orphans | Yes |
| 0132 NOT NULL SQL | AICO-P1-012 | no DEFAULT | Safe migration | Unsafe SQL | Yes |
| Parallel activateTrial | AICO-P1-013 | **2** trial rows | 1 | 2 | Yes |
| UNIQUE fingerprint probe | AICO-P1-013 | second insert succeeded | UNIQUE reject | Allowed | Yes |
| Zero budget key | AICO-P1-016 | keys.size **1** | 0 | $0.01 key | Yes |

### P2

| Test | Finding | Failure summary | Expected | Actual | Blocks |
|---|---|---|---|---|---|
| Money as string (model+router) | AICO-P1-018 | `typeof === 'number'` | string | number | No* |
| Phone invite formats | AICO-P1-022 | `INVITE_IDENTIFIER_MISMATCH` | Accept | Reject | No |
| Org create without phone verify | AICO-P1-023 | org id created | Reject | Allow | No |
| Invite token on list | AICO-P1-026 | tokens present | Omitted | Leaked | No |
| Persian/Arabic/bare-CC normalize | AICO-P1-020 | `null` | E.164 | null | No |
| Fingerprint variants | AICO-P1-021 | 6 fingerprints | 1 | 6 | No |

\*Still release-relevant at scale.

**DB final state examples (failed financial):** after stale-read dual allocate of $80+$80 from $100 → `wallet_balance_usd = -60`, two allocate txs, both member budgets raised.

**Trial DB state:** two `user_trials` rows sharing identical `phone_fingerprint` for canonical `+989121111111`.

---

## 7. Tests blocked by infrastructure

| Test | Reason |
|---|---|
| `AICO-P1-005 (server-db): genuine overlapping DB transactions with barrier` | Needs `TEST_SERVER_DB=1` + `DATABASE_TEST_URL`; Docker/local PG unavailable |
| `AICO-P1-013 (server-db): parallel activateTrial …` | Same |
| Full empty→0131-data→0132 migrate on real ParadeDB | No disposable Postgres |
| Live OpenRouter Management HTTP against real account | Forbidden (no real credentials); fake client used instead |
| Full SPA secret-leak (React Query / bundles / HTML) | Not automated in this pass; source-level probes only |

Under PGlite, `Promise.all` allocate often **serializes** (false sense of safety). The **stale-read injection** test still proves missing SQL CAS independently of engine concurrency.

---

## 8. Newly discovered / sharpened defects

| ID | Note | Severity |
|---|---|---|
| AICO-P2-N01 | `allocateMemberCredit(NaN)` does not throw; can leave non-finite balance | P1 (new evidence under P1-005/017) |
| AICO-P2-N02 | `acceptInvite` succeeds while org `status='suspended'` (model gap beyond chat) | P1 (extends P1-006) |
| AICO-P2-N03 | Concurrent `ensureUserKey` produced **2** in-memory OR keys even on single PGlite (check-then-create race) | Confirms P1-011 |
| AICO-P2-N04 | Static scan: **23** `initModelRuntimeFromDB` call sites lack `assertModelAllowed` | Confirms P1-009 with magnitude |
| AICO-P2-N05 | `users.phone` UNIQUE partially limits dual verified phones, but `activateTrial({phone})` still dual-inserts by fingerprint without UNIQUE — abuse via API param remains | Confirms P1-013 |

No product code was changed; these are evidence, not remediations.

---

## 9. Flaky / nondeterministic behavior

- Multi-org `listForUser` key pick was **stable** across 20 iterations in one run (single silent winner) — still unsafe; explicit context missing.  
- PGlite serialization makes some `Promise.all` allocate tests **pass** even though stale-read proves the bug — do not treat PGlite green as concurrency proof.  
- First `getTestDB()` under root vitest can exceed default 10s hook timeout; Phase 2 hooks use **60s**.

---

## 10. Persistent split-brain states observed

| State | How observed | Recoverable? |
|---|---|---|
| Wallet credited, no OR key | Controllable client `http500` after `mockTopupUser` | Retry `ensureUserKey`; user cannot spend via managed key until then (may env-fallthrough if trial) |
| OR key created, DB key columns empty | Injected `updateUserOpenRouterKey` failure | Orphan on OR; retry creates another (P1-011) |
| Two OR keys for one user | Parallel `ensureUserKey` | Manual reconcile required |
| Member disabled, OR key id retained | `removeMember` | Direct OR use until limit (P1-007) |
| Org suspended, membership/keys live | `setOrganizationStatus` | Spend/list continue (P1-006) |
| Dual trial rows same fingerprint | Parallel `activateTrial` | Abuse quota ×2 |

---

## 11. Coverage by Phase 1 finding ID

| Finding | Executable Phase 2 coverage | Status |
|---|---|---|
| AICO-P1-001 | Router `mockTopup` | **FAIL confirms** |
| AICO-P1-002 | Router `mockOrgTopup` | **FAIL confirms** |
| AICO-P1-003 | Guard resolve | **FAIL confirms** |
| AICO-P1-004 | Management factory + prod probe | **FAIL confirms** |
| AICO-P1-005 | Stale-read + NaN + parallel | **FAIL confirms** (barrier skipped) |
| AICO-P1-006 | list + allocate + invite accept | **FAIL confirms** |
| AICO-P1-007 | removeMember key retain | **FAIL confirms** |
| AICO-P1-008 | Explicit context sentinel | **FAIL confirms** |
| AICO-P1-009 | Call-site scan + allow-list | **FAIL confirms** (23 paths) |
| AICO-P1-010 | Parallel increments | **FAIL confirms** |
| AICO-P1-011 | Parallel ensureUserKey | **FAIL confirms** (2 keys) |
| AICO-P1-012 | SQL + scratch ALTER | **FAIL confirms** / hazard class pass |
| AICO-P1-013 | Parallel activate + UNIQUE probe | **FAIL confirms** |
| AICO-P1-014 | SMS factory | **FAIL confirms** |
| AICO-P1-015 | Chat route static | **FAIL confirms** |
| AICO-P1-016 | Zero budget ensureMemberKey | **FAIL confirms** |
| AICO-P1-017 | FX slices + NaN | Partial / NaN fail |
| AICO-P1-018 | Model + router typeof | **FAIL confirms** |
| AICO-P1-019 | Blocklist-before-delete split | Documented reachable; deletion E2E limited |
| AICO-P1-020 | Persian/Arabic/bare-CC | **FAIL confirms** |
| AICO-P1-021 | Fingerprint set size | **FAIL confirms** |
| AICO-P1-022 | Invite phone formats | **FAIL confirms** |
| AICO-P1-023 | Org create unverified | **FAIL confirms** |
| AICO-P1-024 | Master balance stub | Not asserted live (still stub) |
| AICO-P1-025 | Tx trail after allocate | Pass (append exists; spend still not ledgered) |
| AICO-P1-026 | Invite token list | **FAIL confirms** |
| AICO-P1-027 | SPA loaders | API-only matrix done; UI not |
| AICO-P1-028 | Period budgets | Untested (deferred product) |
| AICO-P1-029 | Weak prior tests | Addressed by this suite |
| AICO-P1-030–032 | Naming/docs/Zarinpal | Out of executable money path |

---

## 12. Remaining untested risks

- Real multi-connection Postgres allocate/trial races (barrier tests ready, env blocked)  
- Stream cancel / failed upstream trial accounting policy  
- Full agent/image/embedding runtime E2E with injected managed key  
- Account deletion transactional crash injection + OR key revoke  
- Ciphertext with wrong `KEY_VAULTS_SECRET` after rotate  
- Client bundle / analytics / Sentry secret exfil  
- Zarinpal (deferred)  
- Master OpenRouter live balance (stub)  

---

## 13. Recommended Phase 3 E2E scenarios

1. Production-like compose: no mock flags, real mgmt key in vault-only secret store — assert mock top-up 403 and SMS non-debug.  
2. Suspended org member opens chat UI — must hard-fail with clear error; OR dashboard key disabled.  
3. Two-browser allocate race on shared org wallet with real Postgres.  
4. Trial user without wallet: chat must not bill shared env key (proxy capture).  
5. Multi-org user: force org A vs B billing selection UI; wrong-org charge impossible.  
6. Remove member mid-session; subsequent requests fail; OR key disabled.  
7. Parallel trial activation same canonical phone (normalized variants).  
8. Invite accept with Persian-digit phone after verify.  
9. Migration rehearsal: DB with post-0131 `usage_logs` rows apply 0132.  
10. Secret red-team: DevTools + network log while provisioning keys — no plaintext.

---

## 14. Counts & artifacts

| Metric | Count |
|---|---|
| Phase 2 tests added (executable) | **66** (34 DB suite + 32 server/phone) |
| Passed | **33** |
| Failed confirming defects | **31** |
| Skipped / infra-blocked | **2** (+ broader live-OR / ParadeDB migrate) |
| Baseline existing Aico tests | **24 passed** |
| New P0 findings | **0 new IDs** (all P0 confirmed) |
| New / sharpened P1 | **AICO-P2-N01…N05** (see §8) |

**Report path:** `AICO_PHASE2_TEST_REPORT.md`

---

*End of Phase 2. No application/production code was modified.*
