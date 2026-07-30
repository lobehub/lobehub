# Aico Phase 3 — Production Release Gate

**Roles:** Release owner · Production-readiness reviewer · SRE · Security tester · E2E QA lead  
**Date:** 2026-07-30  
**Baseline commit:** `b357039491bc5d8c4f027ec8a64139e2a1c5abc3` (`canary`)  
**Product code modified:** **None** (tests, probes, reports only)

---

## 1. Executive release verdict

# **NO-GO**

Phase 3 re-verified the working tree against Phase 1/2 findings and executed an expanded release-gate harness (personas, journeys, Env C fail-closed probes, failure injection, integrity checks, UI/static secret probes).

**No P0 was fixed. Multiple release-blocking P1s remain executable.**  
Per absolute rule 7, GO and CONDITIONAL GO are forbidden.

Financial exposure if this build were deployed with a real OpenRouter management/chat key: **arbitrary authenticated credit minting**, **shared-env trial spend**, and **org over-allocation races**.

---

## 2. Environment details

| Env | Intent | What ran | Status |
|---|---|---|---|
| **A — clean test** | Empty DB + migrations from zero + fake externals + safe test env | PGlite via `getTestDB()`; Controllable/Mock OpenRouter; `KEY_VAULTS_SECRET` test value; no paid credentials | **Exercised**. No ParadeDB/Docker. |
| **B — upgraded DB** | Pre-existing users/orgs/usage + upgrade migrations | Multi-user seeds; static/scratch proof that `0132` `usage_logs.user_id NOT NULL` lacks DEFAULT/backfill; integrity probes | **Partial**. Full ParadeDB upgrade **blocked** (no Docker/Postgres). |
| **C — unsafe production config** | Missing mgmt key, `AICO_OPENROUTER_MOCK=1`, debug OTP, bad FX, incomplete migration | Vitest Env C + static probes | **Exercised**. Product **fails open** on OR mock + Debug SMS + ungated mock top-up. Invalid FX **throws**. |

**Infra barriers:** Docker not installed; local Postgres unavailable; `TEST_SERVER_DB` unset (2 skips); full `bun run build` not completed; `desktopRouter.sync.test.tsx` failed collect on unrelated `setContextMenuInterceptor`; `PRD_Aico.md` / `AICO_IMPLEMENTATION_REVIEW.md` missing (`torobche_phas1/-aico-v1-0.md` present).

**Runtime:** Node v24.15.0, bun 1.3.14, pnpm 10.33.0. Dirty tree = Phase 1–3 artifacts only.

---

## 3. Build and migration results

| Check | Result |
|---|---|
| Migrations through `0132_shocking_blizzard` | Present in journal |
| `0132` upgrade-safe on non-empty `usage_logs` | **FAIL** (no DEFAULT/backfill) |
| Aico routes on web+desktop twins | **Present** (static probe) |
| `desktopRouter.sync.test.tsx` | **Collect FAIL** (inconclusive for Aico) |
| Existing SPA/desktop bundle secret scan | **0 hits** |
| Full production build order | **Not completed** |
| Baseline happy-path Aico tests | **24/24 PASS** |

---

## 4. Persona matrix

Fake Iranian personas in `aico.phase3.helpers.ts`: platform admin, org owner/admin/member, unrelated user, B2C verified/unverified, invited skip-phone, multi-org, personal+org, active/exhausted trial, removed/disabled/suspended-org members, deleted-recreated, attacker (IDs `p3-*`, phones `+98912…`).

---

## 5. E2E journey results

Executed at model + tRPC + static depth (no Playwright compose).

### Journey 1 B2C
- Duplicate trial deny: PASS
- Mock top-up + ledger: PASS (dangerous path exists)
- Blocklist blocks recreate: PASS
- Concurrent increments ≤ max: **FAIL** (3>1) AICO-P1-010
- Prod mockTopup forbidden: **FAIL** AICO-P1-001
- Trial no env fallthrough: **FAIL** AICO-P1-003

### Journey 2 Org
- Create + Unspecified team + invite wrong/right + allocate/over-allocate: PASS
- removeMember clears key: **FAIL** AICO-P1-007
- Suspend hides/blocks: **FAIL** AICO-P1-006
- Explicit billing context API: **FAIL** AICO-P1-008

### Journey 3 Cross-tenant
- Invite mismatch / stranger FORBIDDEN on sensitive org APIs / non-admin platform: PASS
- Invite token on listMembers: **FAIL** AICO-P1-026

### Journey 4 Failure injection
- timeout/401/429→retry: wallet conserved (documented)
- parallel ensureUserKey: **2 keys FAIL** AICO-P1-011
- malformed response fail-closed: **FAIL** AICO-P3-N01

### Journey 5 Concurrency
- dual debit 80+80 on 100 → **-60** (3/3)
- trial parallel increment exceed max: FAIL
- server-db barrier: SKIPPED

### Journey 6 Alternate paths
- assertModelAllowed on all runtime sites: **FAIL** (23 offenders) AICO-P1-009
- usage wiring: **FAIL** AICO-P1-015

### Journey 7 Recovery
- wrong vault secret decrypt null: PASS
- no plaintext in ensure result: PASS
- suspend/remove key revoke: not implemented (manual OR)

---

## 6. Concurrency results

Missing CAS allocate → negative balance; trial TOCTOU; orphan keys; dual trial rows. PGlite may serialize some Promise.all cases — do not treat green parallel allocate as safety.

---

## 7. Failure-injection results

Split-brain classes unchanged: credit without key; OR orphan without DB; dual keys; disabled member key live; suspended org keys live.

---

## 8. Cross-tenant attack results

Org-scoped IDOR generally FORBIDDEN (PASS). Residual: self-serve mock mint, invite token leak, multi-org silent billing, suspend non-enforcing.

---

## 9. UI and RTL results

Routes registered both twins: PASS. Wallet mock UI ungated: FAIL. Locales present: PASS. Playwright RTL: not run (inconclusive).

---

## 10. Data-integrity results

Integrity collector flags duplicate fingerprints and negative wallets when present. Happy-path default team = 1 holds.

---

## 11. Secret-leak review

Wallet API omits key material: PASS. Bundle scan 0 hits: PASS. Invite tokens leaked: FAIL. Debug SMS OTP: FAIL-open.

---

## 12. Operational recovery results

OR timeout → retryable. OR+DB split → operator reconcile (retry worsens orphans). Suspend/remove → manual OR disable. Bad 0132 → deploy abort.

---

## 13. Previously reported findings

- **Fixed:** none (same HEAD; no product diffs)
- **Still reproducible:** all Phase 1 P0s and blocking P1s via Phase 2/3 FAILs
- **Inconclusive:** ParadeDB upgrade, Playwright UI, full production build, router sync collect, live OR

---

## 14. New findings

| ID | Severity | Note |
|---|---|---|
| AICO-P3-N01 | P1 | Malformed OR create path not reliably fail-closed |
| AICO-P3-N02 | Info | Integrity collector useful post-fix oracle |
| AICO-P3-N03 | P2 | Router sync test collect broken in this workspace |

---

## 15. Release blockers

Canonical cards in `AICO_RELEASE_BLOCKERS.md`.

---

## 16. Required remediation order

1. Gate/remove mock top-ups; fail-closed OR management + SMS; deny trial env fallthrough  
2. Suspend/remove disable OR keys + deny resolve/chat/allocate  
3. CAS allocate; atomic trial; UNIQUE fingerprint; idempotent ensureKey  
4. Centralize assert+usage; explicit billing context  
5. Fix migration 0132  
6. Hygiene: money strings, phone normalize, invite tokens, org phone gate  

---

## 17. Retest plan

Re-run Phase 2+3 packs green; Env A ParadeDB compose; Env B upgrade rehearsal; Env C boot fail; Playwright wallet/org/suspend; Postgres race load; secret red-team.

---

## 18. Final decision

# **NO-GO**

| Metric | Value |
|---|---|
| Verdict | NO-GO |
| P0 open | 4 (001–004) |
| P1 blocking open | ≥16 |
| P2 open | ≥10 |
| Gate passed | 50 |
| Gate failed | 46 |
| Gate skipped | 2 |
| Baseline happy-path | 24/24 (not safety) |

*No application/production code was modified.*