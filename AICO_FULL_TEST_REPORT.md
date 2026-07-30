# Aico Full Test Execution Report (AI Review Package)

> **Purpose:** Complete record of every Aico-related test executed in the Phase 2 adversarial campaign.
> **Audience:** Downstream AI reviewer / human auditor.
> **Product code modified:** NONE. Only test files + reports.
> **Companion docs:** `AICO_PHASE1_AUDIT.md`, `AICO_PHASE2_TEST_REPORT.md`, `PRD_Aico.md`.

---

## 0. Meta

| Field | Value |
|---|---|
| Generated at (UTC) | 2026-07-30T08:35:24.252Z |
| Repo | lobehub |
| Branch | canary |
| HEAD | `b357039491bc5d8c4f027ec8a64139e2a1c5abc3` |
| Campaign | Aico Phase 2 adversarial testing |
| Seed label | `phase2-2026-07-30` |
| DB engine | PGlite via `getTestDB()` (default). Real Postgres unavailable. |
| Docker / local PG | Not available (ports closed) |
| `DATABASE_TEST_URL` | UNSET |
| KEY_VAULTS_SECRET | Test-only valid 32-byte base64 (not production) |
| External APIs | Controllable fake OpenRouter only — no real credentials |

## 1. Executive totals

| Metric | Count |
|---|---:|
| Total unique tests executed | 90 |
| Passed | 57 |
| Failed (defect evidence) | 31 |
| Skipped / infra-blocked | 2 |

**Release verdict: NO-GO.** Failures assert *safe* invariants that the implementation violates. Do not “fix” by weakening tests.

### Breakdown

| Bucket | What it contains |
|---|---|
| Baseline | Pre-existing happy-path Aico tests (`aicoBilling`, `organization`, `chatGuard`, `management`, `phone`) |
| Phase 2 adversarial | New invariant tests mapped to AICO-P1-* findings |

## 2. Commands that produced this inventory

```bash
# Phase 2 — database adversarial
cd packages/database
bunx vitest run \
  src/models/__tests__/aico.financialConcurrency.test.ts \
  src/models/__tests__/aico.trialAbuse.test.ts \
  src/models/__tests__/aico.invitationLifecycle.test.ts \
  src/models/__tests__/aico.multiOrgMigration.test.ts

# Phase 2 — server / router / phone adversarial
cd <repo-root>
export KEY_VAULTS_SECRET=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=
bunx vitest run \
  apps/server/src/services/openrouter/aico.keyFailureInjection.test.ts \
  apps/server/src/services/aico/aico.chatBypassProduction.test.ts \
  apps/server/src/routers/lambda/__tests__/aico.rbacIdor.test.ts \
  src/libs/better-auth/phone.aico.phase2.test.ts

# Baseline — pre-existing
cd packages/database && bunx vitest run \
  src/models/__tests__/aicoBilling.test.ts \
  src/models/__tests__/organization.test.ts
cd <repo-root> && bunx vitest run \
  apps/server/src/services/aico/chatGuard.test.ts \
  apps/server/src/services/openrouter/management.test.ts \
  src/libs/better-auth/phone.test.ts
```

## 3. How to interpret results

1. Phase 2 tests assert **release-safe** behavior, not current buggy behavior.
2. **FAIL** ≈ confirmed defect (successful adversarial outcome).
3. **PASS** ≈ invariant holds OR documents a recoverable split-brain without requiring a product green.
4. **SKIP** ≈ blocked (`TEST_SERVER_DB=1` + real Postgres required).
5. Remediation = change product code until FAILs become PASSes **without** softening assertions.

## 4. Complete test inventory (all files)

### `apps/server/src/routers/lambda/__tests__/aico.rbacIdor.test.ts`

Pass **5** · Fail **5** · Skip **0**

| # | Status | Finding IDs | Test name | ms | Failure summary |
|---:|---|---|---|---:|---|
| 1 | FAIL | AICO-P1-001 | Aico RBAC / IDOR matrix (Phase 2) AICO-P1-001: mockTopup is callable by any authenticated user (must be production-forbidden) | 14528 | AssertionError: expected false to be true // Object.is equality |
| 2 | FAIL | AICO-P1-002 | Aico RBAC / IDOR matrix (Phase 2) AICO-P1-002: org owner can mockOrgTopup (must be platform-admin-only / prod-forbidden) | 199 | AssertionError: expected false to be true // Object.is equality |
| 3 | FAIL | AICO-P1-018 | Aico RBAC / IDOR matrix (Phase 2) AICO-P1-018: getMyWallet returns number balances (contract expects strings) | 162 | AssertionError: expected 'number' to be 'string' // Object.is equality |
| 4 | FAIL | AICO-P1-023 | Aico RBAC / IDOR matrix (Phase 2) AICO-P1-023: unverified phone can still create organization | 158 | AssertionError: expected 'org_nz064PN5xbjW' to be undefined |
| 5 | FAIL | AICO-P1-026 | Aico RBAC / IDOR matrix (Phase 2) AICO-P1-026: inviteMember response includes raw token | 101 | AssertionError: expected false to be true // Object.is equality |
| 6 | PASS |  | Aico RBAC / IDOR matrix (Phase 2) member cannot listMembers / getOrgWallet / allocate (IDOR deny) | 199 |  |
| 7 | PASS |  | Aico RBAC / IDOR matrix (Phase 2) non-platform user cannot call platformAdmin mutations | 82 |  |
| 8 | PASS |  | Aico RBAC / IDOR matrix (Phase 2) platform admin can suspend; member procedures still reachable on model (enforcement gap covered elsewhere) | 95 |  |
| 9 | PASS |  | Aico RBAC / IDOR matrix (Phase 2) removed member cannot manage org after disable | 180 |  |
| 10 | PASS |  | Aico RBAC / IDOR matrix (Phase 2) stranger cannot access another org by substituting orgId (IDOR) | 132 |  |

### `apps/server/src/services/aico/aico.chatBypassProduction.test.ts`

Pass **5** · Fail **5** · Skip **0**

| # | Status | Finding IDs | Test name | ms | Failure summary |
|---:|---|---|---|---:|---|
| 1 | FAIL | AICO-P1-009 | Aico chat-path bypass probes (Phase 2) AICO-P1-009: every initModelRuntimeFromDB call site must also enforce assertModelAllowed | 352 | AssertionError: expected [ …(23) ] to deeply equal [] |
| 2 | FAIL | AICO-P1-015 | Aico chat-path bypass probes (Phase 2) AICO-P1-015: chat route must call recordUsage or syncMemberUsage | 3 | AssertionError: expected false to be true // Object.is equality |
| 3 | FAIL | AICO-P1-004 | Aico production safety (Phase 2) AICO-P1-004: createOpenRouterManagementClient without key returns mock | 2 | AssertionError: expected 'MockOpenRouterManagementClient' not to contain 'Mock' |
| 4 | FAIL | AICO-P1-014 | Aico production safety (Phase 2) AICO-P1-014: missing KAVENEGAR_API_KEY selects Debug SMS (must fail-closed in production) | 3 | AssertionError: expected 'DebugSmsService' not to match /Debug/i |
| 5 | FAIL | AICO-P1-003 | AicoChatGuard trial fallthrough (Phase 2) AICO-P1-003: active trial without managed key resolves null (env key fallthrough) | 15622 | AssertionError: expected null not to be null |
| 6 | PASS |  | Aico production safety (Phase 2) tomanToUsd rejects non-positive FX rate | 1 |  |
| 7 | PASS |  | Aico secret leak probes (Phase 2) AicoOpenRouterKeyService resolve is server-only and not mounted on aicoBilling router | 7 |  |
| 8 | PASS |  | Aico secret leak probes (Phase 2) getMyWallet response shape must not include key material fields | 1 |  |
| 9 | PASS | AICO-P1-009 | AicoChatGuard trial fallthrough (Phase 2) AICO-P1-009: team allow-list denies model | 163 |  |
| 10 | PASS |  | AicoChatGuard trial fallthrough (Phase 2) alternate model alias must not bypass trial allow-list | 180 |  |

### `apps/server/src/services/aico/chatGuard.test.ts`

Pass **2** · Fail **0** · Skip **0**

| # | Status | Finding IDs | Test name | ms | Failure summary |
|---:|---|---|---|---:|---|
| 1 | PASS |  | AicoChatGuard maps aico runtime to openrouter | 0 |  |
| 2 | PASS |  | AicoChatGuard treats aico and openrouter as managed providers | 2 |  |

### `apps/server/src/services/openrouter/aico.keyFailureInjection.test.ts`

Pass **4** · Fail **4** · Skip **0**

| # | Status | Finding IDs | Test name | ms | Failure summary |
|---:|---|---|---|---:|---|
| 1 | FAIL | AICO-P1-004 | Aico OpenRouter failure injection (Phase 2) AICO-P1-004: AICO_OPENROUTER_MOCK=1 works even when NODE_ENV=production | 150 | AssertionError: expected false to be true // Object.is equality |
| 2 | FAIL | AICO-P1-004 | Aico OpenRouter failure injection (Phase 2) AICO-P1-004: missing management key silently selects Mock client (production fail-open) | 15676 | AssertionError: expected true to be false // Object.is equality |
| 3 | FAIL | AICO-P1-011 | Aico OpenRouter failure injection (Phase 2) AICO-P1-011: concurrent ensureUserKey can create orphan OpenRouter keys | 179 | AssertionError: expected 2 to be 1 // Object.is equality |
| 4 | FAIL | AICO-P1-016 | Aico OpenRouter failure injection (Phase 2) AICO-P1-016: ensureMemberKey floors new keys at $0.01 even for zero budget | 108 | AssertionError: expected 1 to be +0 // Object.is equality |
| 5 | PASS |  | Aico OpenRouter failure injection (Phase 2) AICO-P1 secret: ensureUserKey never returns plaintext key to caller | 51 |  |
| 6 | PASS |  | Aico OpenRouter failure injection (Phase 2) ciphertext corruption: decrypt fails closed (null or throw, never garbage key) | 90 |  |
| 7 | PASS |  | Aico OpenRouter failure injection (Phase 2) DB succeeds, OpenRouter create fails — wallet credit remains, no key id (split-brain credit) | 129 |  |
| 8 | PASS |  | Aico OpenRouter failure injection (Phase 2) OpenRouter succeeds then DB key update failure leaves orphan key | 129 |  |

### `apps/server/src/services/openrouter/management.test.ts`

Pass **2** · Fail **0** · Skip **0**

| # | Status | Finding IDs | Test name | ms | Failure summary |
|---:|---|---|---|---:|---|
| 1 | PASS |  | HttpOpenRouterManagementClient posts create payload to OpenRouter keys endpoint | 7 |  |
| 2 | PASS |  | MockOpenRouterManagementClient creates, updates, and deletes keys | 11 |  |

### `packages/database/src/models/__tests__/aico.financialConcurrency.test.ts`

Pass **4** · Fail **3** · Skip **1**

| # | Status | Finding IDs | Test name | ms | Failure summary |
|---:|---|---|---|---:|---|
| 1 | FAIL | AICO-P1-005 | Aico financial concurrency & money invariants (Phase 2) AICO-P1-005: rejects zero/negative/NaN-like allocate amounts | 203 | AssertionError: expected false to be true // Object.is equality |
| 2 | FAIL | AICO-P1-005 | Aico financial concurrency & money invariants (Phase 2) AICO-P1-005: stale-read injection proves missing CAS allows overspend | 473 | AssertionError: expected -60 to be greater than or equal to 0 |
| 3 | FAIL | AICO-P1-018 | Aico money wire contract probes (Phase 2) AICO-P1-018: model returns numeric wallet fields today (contract expects strings) | 97 | AssertionError: expected 'number' to be 'string' // Object.is equality |
| 4 | PASS | AICO-P1-005 | Aico financial concurrency & money invariants (Phase 2) AICO-P1-005: many parallel allocations exceeding balance conserve non-negative USD | 226 |  |
| 5 | PASS | AICO-P1-005 | Aico financial concurrency & money invariants (Phase 2) AICO-P1-005: parallel allocate 80+80 on 100 must not leave negative balance | 521 |  |
| 6 | PASS | AICO-P1-017 | Aico financial concurrency & money invariants (Phase 2) AICO-P1-017: FX-style microdollar rounding does not invent money on allocate sums | 220 |  |
| 7 | PASS | AICO-P1-025 | Aico financial concurrency & money invariants (Phase 2) AICO-P1-025: allocate tx rows exist for every successful debit (append-only trail) | 175 |  |
| 8 | SKIP | AICO-P1-005 | Aico financial concurrency & money invariants (Phase 2) AICO-P1-005 (server-db): genuine overlapping DB transactions with barrier |  |  |

### `packages/database/src/models/__tests__/aico.invitationLifecycle.test.ts`

Pass **8** · Fail **4** · Skip **0**

| # | Status | Finding IDs | Test name | ms | Failure summary |
|---:|---|---|---|---:|---|
| 1 | FAIL |  | Aico invitation security (Phase 2) acceptance after organization suspend — invite create blocked at router; model still accepts pending | 172 | Error: promise resolved "{ member: { …(9) }, …(1) }" instead of rejecting |
| 2 | FAIL | AICO-P1-022 | Aico invitation security (Phase 2) AICO-P1-022: phone invite accept without normalize may fail across formats | 221 | Error: promise rejected "Error: INVITE_IDENTIFIER_MISMATCH" instead of resolving |
| 3 | FAIL | AICO-P1-006 | Aico organization lifecycle (Phase 2) AICO-P1-006: suspended org still listed for member and allocate still works (non-enforcing) | 168 | AssertionError: expected { id: 'org_K3BroNA5cDIl', …(9) } to be undefined |
| 4 | FAIL | AICO-P1-007 | Aico organization lifecycle (Phase 2) AICO-P1-007: removeMember only soft-disables; budget key fields remain | 176 | AssertionError: expected 'or-key-alive' to be null |
| 5 | PASS | AICO-P1-026 | Aico invitation security (Phase 2) AICO-P1-026: createInvite returns raw token (secret exposure surface) | 150 |  |
| 6 | PASS |  | Aico invitation security (Phase 2) expired token cannot be accepted | 490 |  |
| 7 | PASS |  | Aico invitation security (Phase 2) malformed / unknown token fails closed | 114 |  |
| 8 | PASS |  | Aico invitation security (Phase 2) reused token after accept fails | 268 |  |
| 9 | PASS |  | Aico invitation security (Phase 2) revoked invite cannot be accepted | 111 |  |
| 10 | PASS |  | Aico invitation security (Phase 2) wrong email cannot accept invite | 129 |  |
| 11 | PASS |  | Aico organization lifecycle (Phase 2) cannot delete default team | 133 |  |
| 12 | PASS |  | Aico organization lifecycle (Phase 2) cannot demote last owner | 102 |  |

### `packages/database/src/models/__tests__/aico.multiOrgMigration.test.ts`

Pass **3** · Fail **2** · Skip **0**

| # | Status | Finding IDs | Test name | ms | Failure summary |
|---:|---|---|---|---:|---|
| 1 | FAIL | AICO-P1-012 | Aico migration & schema safety (Phase 2) AICO-P1-012: migration 0132 adds usage_logs.user_id NOT NULL without DEFAULT | 250 | AssertionError: expected false to be true // Object.is equality |
| 2 | FAIL | AICO-P1-008 | Aico multi-organization billing context (Phase 2) AICO-P1-008: two org memberships — listForUser order is nondeterministic (no orderBy) | 1003 | AssertionError: expected false to be true // Object.is equality |
| 3 | PASS | AICO-P1-012 | Aico migration & schema safety (Phase 2) AICO-P1-012: adding NOT NULL column without default fails when usage_logs has rows | 164 |  |
| 4 | PASS | AICO-P1-013 | Aico migration & schema safety (Phase 2) AICO-P1-013: user_trials phone_fingerprint index is not UNIQUE in migration SQL | 87 |  |
| 5 | PASS | AICO-P1-015 | Aico migration & schema safety (Phase 2) AICO-P1-015: recordUsage can write rows but chat path does not call it (probe after manual record) | 92 |  |

### `packages/database/src/models/__tests__/aico.trialAbuse.test.ts`

Pass **3** · Fail **5** · Skip **1**

| # | Status | Finding IDs | Test name | ms | Failure summary |
|---:|---|---|---|---:|---|
| 1 | FAIL | AICO-P1-010 | Aico trial abuse & concurrency (Phase 2) AICO-P1-010: assert-style check with stale count allows double spend of last request | 87 | AssertionError: expected 2 to be less than or equal to 1 |
| 2 | FAIL | AICO-P1-010 | Aico trial abuse & concurrency (Phase 2) AICO-P1-010: trial request increment lacks atomic reserve — parallel increments exceed maxRequests | 83 | AssertionError: expected 3 to be less than or equal to 1 |
| 3 | FAIL | AICO-P1-013 | Aico trial abuse & concurrency (Phase 2) AICO-P1-013: DB has no UNIQUE on phone_fingerprint (schema invariant probe) | 151 | AssertionError: expected true to be false // Object.is equality |
| 4 | FAIL | AICO-P1-013 | Aico trial abuse & concurrency (Phase 2) AICO-P1-013: two users activating trial with same phone — exactly one row | 268 | AssertionError: expected [ …(2) ] to have a length of 1 but got 2 |
| 5 | FAIL | AICO-P1-021 | Aico trial abuse & concurrency (Phase 2) AICO-P1-021: phone format variants must canonicalize to one fingerprint | 60 | AssertionError: expected 6 to be 1 // Object.is equality |
| 6 | PASS | AICO-P1-019 | Aico trial abuse & concurrency (Phase 2) AICO-P1-019: blocklist write then delete is not atomic — blocklist remains if delete skipped | 68 |  |
| 7 | PASS | AICO-P1-019 | Aico trial abuse & concurrency (Phase 2) AICO-P1-019: recreation after blocklist cannot activate trial | 79 |  |
| 8 | PASS |  | Aico trial abuse & concurrency (Phase 2) disabled trial config rejects activation | 98 |  |
| 9 | SKIP | AICO-P1-013 | Aico trial abuse & concurrency (Phase 2) AICO-P1-013 (server-db): parallel activateTrial same phone — one success |  |  |

### `packages/database/src/models/__tests__/aicoBilling.test.ts`

Pass **2** · Fail **0** · Skip **0**

| # | Status | Finding IDs | Test name | ms | Failure summary |
|---:|---|---|---|---:|---|
| 1 | PASS |  | AicoBillingModel getOrCreateUserWallet is idempotent | 149 |  |
| 2 | PASS |  | AicoBillingModel updates trial config | 68 |  |

### `packages/database/src/models/__tests__/organization.test.ts`

Pass **10** · Fail **0** · Skip **0**

| # | Status | Finding IDs | Test name | ms | Failure summary |
|---:|---|---|---|---:|---|
| 1 | PASS |  | AicoBillingModel activates trial once per user/phone and blocks abuse fingerprints | 58 |  |
| 2 | PASS |  | AicoBillingModel mock topup credits user wallet | 56 |  |
| 3 | PASS |  | OrganizationModel allocates member credit from org wallet without over-allocating | 103 |  |
| 4 | PASS |  | OrganizationModel assignManager and manual credit with USD | 92 |  |
| 5 | PASS |  | OrganizationModel cannot demote last owner | 67 |  |
| 6 | PASS |  | OrganizationModel creates org with owner membership and default Unspecified team | 302 |  |
| 7 | PASS |  | OrganizationModel invite + accept by email attaches default team | 109 |  |
| 8 | PASS |  | OrganizationModel platform admin helpers | 168 |  |
| 9 | PASS |  | OrganizationModel rejects invite identifier mismatch | 76 |  |
| 10 | PASS |  | OrganizationModel sets team model access allow-list | 56 |  |

### `src/libs/better-auth/phone.aico.phase2.test.ts`

Pass **1** · Fail **3** · Skip **0**

| # | Status | Finding IDs | Test name | ms | Failure summary |
|---:|---|---|---|---:|---|
| 1 | FAIL | AICO-P1-020 | Iranian phone normalize adversarial (Phase 2) AICO-P1-020: Arabic-Indic digits normalize to E.164 | 3 | AssertionError: expected null to be '+989121111111' // Object.is equality |
| 2 | FAIL | AICO-P1-020 | Iranian phone normalize adversarial (Phase 2) AICO-P1-020: bare country-code without plus should normalize | 1 | AssertionError: expected null to be '+989121111111' // Object.is equality |
| 3 | FAIL | AICO-P1-020 | Iranian phone normalize adversarial (Phase 2) AICO-P1-020: Persian digits normalize to E.164 | 10 | AssertionError: expected null to be '+989121111111' // Object.is equality |
| 4 | PASS | AICO-P1-020 | Iranian phone normalize adversarial (Phase 2) AICO-P1-020: ASCII local and E.164 variants normalize | 5 |  |

### `src/libs/better-auth/phone.test.ts`

Pass **8** · Fail **0** · Skip **0**

| # | Status | Finding IDs | Test name | ms | Failure summary |
|---:|---|---|---|---:|---|
| 1 | PASS |  | buildPhoneVerifyRedirectUrl falls back to / for unsafe targets | 0 |  |
| 2 | PASS |  | buildPhoneVerifyRedirectUrl is idempotent when already on verify-phone | 0 |  |
| 3 | PASS |  | buildPhoneVerifyRedirectUrl threads a safe callbackUrl | 0 |  |
| 4 | PASS |  | isValidIranianPhoneNumber mirrors normalize success | 0 |  |
| 5 | PASS |  | normalizeIranianPhoneNumber accepts E.164 +989… | 3 |  |
| 6 | PASS |  | normalizeIranianPhoneNumber normalizes local 09… and 9… | 1 |  |
| 7 | PASS |  | normalizeIranianPhoneNumber rejects landlines and foreign numbers | 0 |  |
| 8 | PASS |  | normalizeIranianPhoneNumber strips spaces and dashes | 0 |  |

## 5. Failed tests only (defect evidence index)

| # | Finding IDs | Test | Failure summary |
|---:|---|---|---|
| 1 | AICO-P1-005 | Aico financial concurrency & money invariants (Phase 2) AICO-P1-005: stale-read injection proves missing CAS allows overspend | AssertionError: expected -60 to be greater than or equal to 0 |
| 2 | AICO-P1-005 | Aico financial concurrency & money invariants (Phase 2) AICO-P1-005: rejects zero/negative/NaN-like allocate amounts | AssertionError: expected false to be true // Object.is equality |
| 3 | AICO-P1-018 | Aico money wire contract probes (Phase 2) AICO-P1-018: model returns numeric wallet fields today (contract expects strings) | AssertionError: expected 'number' to be 'string' // Object.is equality |
| 4 | AICO-P1-022 | Aico invitation security (Phase 2) AICO-P1-022: phone invite accept without normalize may fail across formats | Error: promise rejected "Error: INVITE_IDENTIFIER_MISMATCH" instead of resolving |
| 5 | (see name) | Aico invitation security (Phase 2) acceptance after organization suspend — invite create blocked at router; model still accepts pending | Error: promise resolved "{ member: { …(9) }, …(1) }" instead of rejecting |
| 6 | AICO-P1-006 | Aico organization lifecycle (Phase 2) AICO-P1-006: suspended org still listed for member and allocate still works (non-enforcing) | AssertionError: expected { id: 'org_K3BroNA5cDIl', …(9) } to be undefined |
| 7 | AICO-P1-007 | Aico organization lifecycle (Phase 2) AICO-P1-007: removeMember only soft-disables; budget key fields remain | AssertionError: expected 'or-key-alive' to be null |
| 8 | AICO-P1-008 | Aico multi-organization billing context (Phase 2) AICO-P1-008: two org memberships — listForUser order is nondeterministic (no orderBy) | AssertionError: expected false to be true // Object.is equality |
| 9 | AICO-P1-012 | Aico migration & schema safety (Phase 2) AICO-P1-012: migration 0132 adds usage_logs.user_id NOT NULL without DEFAULT | AssertionError: expected false to be true // Object.is equality |
| 10 | AICO-P1-013 | Aico trial abuse & concurrency (Phase 2) AICO-P1-013: two users activating trial with same phone — exactly one row | AssertionError: expected [ …(2) ] to have a length of 1 but got 2 |
| 11 | AICO-P1-013 | Aico trial abuse & concurrency (Phase 2) AICO-P1-013: DB has no UNIQUE on phone_fingerprint (schema invariant probe) | AssertionError: expected true to be false // Object.is equality |
| 12 | AICO-P1-021 | Aico trial abuse & concurrency (Phase 2) AICO-P1-021: phone format variants must canonicalize to one fingerprint | AssertionError: expected 6 to be 1 // Object.is equality |
| 13 | AICO-P1-010 | Aico trial abuse & concurrency (Phase 2) AICO-P1-010: trial request increment lacks atomic reserve — parallel increments exceed maxRequests | AssertionError: expected 3 to be less than or equal to 1 |
| 14 | AICO-P1-010 | Aico trial abuse & concurrency (Phase 2) AICO-P1-010: assert-style check with stale count allows double spend of last request | AssertionError: expected 2 to be less than or equal to 1 |
| 15 | AICO-P1-020 | Iranian phone normalize adversarial (Phase 2) AICO-P1-020: Persian digits normalize to E.164 | AssertionError: expected null to be '+989121111111' // Object.is equality |
| 16 | AICO-P1-020 | Iranian phone normalize adversarial (Phase 2) AICO-P1-020: Arabic-Indic digits normalize to E.164 | AssertionError: expected null to be '+989121111111' // Object.is equality |
| 17 | AICO-P1-020 | Iranian phone normalize adversarial (Phase 2) AICO-P1-020: bare country-code without plus should normalize | AssertionError: expected null to be '+989121111111' // Object.is equality |
| 18 | AICO-P1-009 | Aico chat-path bypass probes (Phase 2) AICO-P1-009: every initModelRuntimeFromDB call site must also enforce assertModelAllowed | AssertionError: expected [ …(23) ] to deeply equal [] |
| 19 | AICO-P1-015 | Aico chat-path bypass probes (Phase 2) AICO-P1-015: chat route must call recordUsage or syncMemberUsage | AssertionError: expected false to be true // Object.is equality |
| 20 | AICO-P1-003 | AicoChatGuard trial fallthrough (Phase 2) AICO-P1-003: active trial without managed key resolves null (env key fallthrough) | AssertionError: expected null not to be null |
| 21 | AICO-P1-014 | Aico production safety (Phase 2) AICO-P1-014: missing KAVENEGAR_API_KEY selects Debug SMS (must fail-closed in production) | AssertionError: expected 'DebugSmsService' not to match /Debug/i |
| 22 | AICO-P1-004 | Aico production safety (Phase 2) AICO-P1-004: createOpenRouterManagementClient without key returns mock | AssertionError: expected 'MockOpenRouterManagementClient' not to contain 'Mock' |
| 23 | AICO-P1-004 | Aico OpenRouter failure injection (Phase 2) AICO-P1-004: missing management key silently selects Mock client (production fail-open) | AssertionError: expected true to be false // Object.is equality |
| 24 | AICO-P1-004 | Aico OpenRouter failure injection (Phase 2) AICO-P1-004: AICO_OPENROUTER_MOCK=1 works even when NODE_ENV=production | AssertionError: expected false to be true // Object.is equality |
| 25 | AICO-P1-011 | Aico OpenRouter failure injection (Phase 2) AICO-P1-011: concurrent ensureUserKey can create orphan OpenRouter keys | AssertionError: expected 2 to be 1 // Object.is equality |
| 26 | AICO-P1-016 | Aico OpenRouter failure injection (Phase 2) AICO-P1-016: ensureMemberKey floors new keys at $0.01 even for zero budget | AssertionError: expected 1 to be +0 // Object.is equality |
| 27 | AICO-P1-001 | Aico RBAC / IDOR matrix (Phase 2) AICO-P1-001: mockTopup is callable by any authenticated user (must be production-forbidden) | AssertionError: expected false to be true // Object.is equality |
| 28 | AICO-P1-002 | Aico RBAC / IDOR matrix (Phase 2) AICO-P1-002: org owner can mockOrgTopup (must be platform-admin-only / prod-forbidden) | AssertionError: expected false to be true // Object.is equality |
| 29 | AICO-P1-023 | Aico RBAC / IDOR matrix (Phase 2) AICO-P1-023: unverified phone can still create organization | AssertionError: expected 'org_nz064PN5xbjW' to be undefined |
| 30 | AICO-P1-026 | Aico RBAC / IDOR matrix (Phase 2) AICO-P1-026: inviteMember response includes raw token | AssertionError: expected false to be true // Object.is equality |
| 31 | AICO-P1-018 | Aico RBAC / IDOR matrix (Phase 2) AICO-P1-018: getMyWallet returns number balances (contract expects strings) | AssertionError: expected 'number' to be 'string' // Object.is equality |

## 6. Phase 1 finding → Phase 2 coverage

| Finding | Covered how | Result |
|---|---|---|
| AICO-P1-001 | Router mockTopup production gate | FAIL confirms |
| AICO-P1-002 | Router mockOrgTopup gate | FAIL confirms |
| AICO-P1-003 | Trial resolveManagedApiKey returns null | FAIL confirms |
| AICO-P1-004 | OpenRouter management silent mock | FAIL confirms |
| AICO-P1-005 | Stale-read allocate overspend + NaN | FAIL confirms |
| AICO-P1-006 | Suspend list / invite accept | FAIL confirms |
| AICO-P1-007 | removeMember retains openrouterKeyId | FAIL confirms |
| AICO-P1-008 | Explicit multi-org billing context missing | FAIL confirms |
| AICO-P1-009 | 23 initModelRuntimeFromDB sites unguarded | FAIL confirms |
| AICO-P1-010 | Trial requestCount exceeds maxRequests | FAIL confirms |
| AICO-P1-011 | Parallel ensureUserKey → 2 OR keys | FAIL confirms |
| AICO-P1-012 | 0132 user_id NOT NULL without DEFAULT | FAIL confirms |
| AICO-P1-013 | Dual trial rows / no UNIQUE fingerprint | FAIL confirms |
| AICO-P1-014 | Debug SMS when Kavenegar missing | FAIL confirms |
| AICO-P1-015 | Chat route missing usage wiring | FAIL confirms |
| AICO-P1-016 | Zero budget creates $0.01 key | FAIL confirms |
| AICO-P1-017 | Float/NaN money path | Partial / FAIL on NaN |
| AICO-P1-018 | Money as strings on wire | FAIL confirms |
| AICO-P1-019 | Blocklist/delete sequencing | Documented; limited E2E |
| AICO-P1-020 | Persian/Arabic/bare-CC phone normalize | FAIL confirms |
| AICO-P1-021 | Fingerprint canonicalization | FAIL confirms |
| AICO-P1-022 | Invite phone format mismatch | FAIL confirms |
| AICO-P1-023 | Org create without phone verify | FAIL confirms |
| AICO-P1-024 | Master balance stub | Not live-tested |
| AICO-P1-025 | Mutable balances vs ledger | Partial (tx trail PASS) |
| AICO-P1-026 | Invite tokens in list payloads | FAIL confirms |
| AICO-P1-027 | SPA RBAC loaders | API matrix only |
| AICO-P1-028 | Budget period unused | Untested / deferred |
| AICO-P1-029 | Weak prior tests | Addressed by this campaign |
| AICO-P1-030 | key_hash naming | Out of scope |
| AICO-P1-031 | Missing implementation review doc | Still missing |
| AICO-P1-032 | Zarinpal deferred | Out of scope |

## 7. Split-brain states observed

1. Wallet credited + OpenRouter create HTTP 500 → balance present, no key id.
2. OpenRouter create OK + DB key persist fails → orphan OR key.
3. Parallel `ensureUserKey` → 2 OR keys for one user.
4. `removeMember` → membership disabled, `openrouterKeyId` retained.
5. Org suspended → still listed; model still accepts invite.
6. Dual `user_trials` rows share the same `phone_fingerprint`.
7. Stale-read dual allocate $80+$80 from $100 → balance **-60**.

## 8. New / sharpened findings (Phase 2)

| ID | Summary | Severity |
|---|---|---|
| AICO-P2-N01 | `allocateMemberCredit(NaN)` does not throw; can leave non-finite balance | P1 |
| AICO-P2-N02 | `acceptInvite` succeeds when org `status=suspended` | P1 |
| AICO-P2-N03 | Concurrent `ensureUserKey` created 2 keys on fake OR client | P1 confirm |
| AICO-P2-N04 | Static scan: 23 `initModelRuntimeFromDB` sites without `assertModelAllowed` | P1 confirm |
| AICO-P2-N05 | `activateTrial` phone uniqueness not DB-enforced (despite `users.phone` UNIQUE) | P1 confirm |

## 9. Infrastructure limits

- No Docker; Postgres ports closed; remote DATABASE_URL TCP timeout.
- Server-db barrier concurrency tests skipped (`TEST_SERVER_DB=1` / `DATABASE_TEST_URL`).
- PGlite serializes many `Promise.all` DB transactions — stale-read injection still proves allocate CAS gap.
- No real OpenRouter Management credentials used.

## 10. Files added in Phase 2

```
packages/database/src/models/__tests__/aico.phase2.helpers.ts
packages/database/src/models/__tests__/aico.financialConcurrency.test.ts
packages/database/src/models/__tests__/aico.trialAbuse.test.ts
packages/database/src/models/__tests__/aico.invitationLifecycle.test.ts
packages/database/src/models/__tests__/aico.multiOrgMigration.test.ts
apps/server/src/services/openrouter/aico.keyFailureInjection.test.ts
apps/server/src/services/aico/aico.chatBypassProduction.test.ts
apps/server/src/routers/lambda/__tests__/aico.rbacIdor.test.ts
src/libs/better-auth/phone.aico.phase2.test.ts
AICO_PHASE2_TEST_REPORT.md
AICO_FULL_TEST_REPORT.md
```

## 11. Instructions for reviewing AI

1. Treat FAIL rows with Finding IDs as **confirmed defects**, not flaky CI.
2. Cross-check each FAIL against `AICO_PHASE1_AUDIT.md` evidence sections.
3. Do not recommend deleting failing tests; recommend product fixes that turn FAIL→PASS.
4. Remediation priority: P0-001, P0-003, P0-002, P0-004, then P1-005 / 006 / 011 / 013 / 009.
5. After fixes, re-run commands in §2; inventory must improve without assertion weakening.
6. Blocked items need real Postgres (+ optional ParadeDB) for true multi-connection races and migration rehearsal.

## 12. Final copy block

```
TOTAL=90
PASSED=57
FAILED_DEFECT_EVIDENCE=31
SKIPPED_BLOCKED=2
RELEASE_VERDICT=NO-GO
PRODUCT_CODE_MODIFIED=false
```

*End of full test execution report.*