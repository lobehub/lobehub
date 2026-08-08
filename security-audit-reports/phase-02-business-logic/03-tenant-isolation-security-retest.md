# Phase 02 — Tenant Isolation Security Retest

| Field             | Value                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| **Parent report** | `security-audit-reports/phase-02-business-logic/03-tenant-isolation-security.md`                      |
| **Retest date**   | 2026-08-08                                                                                            |
| **Scope**         | Fixes for TENANT-001, TENANT-002, TENANT-004, TENANT-009                                              |
| **Verification**  | `bun run check --test apps/server/src/routers/lambda/__tests__/aico.rbacIdor.test.ts` → **16 passed** |

---

## Code changes

| Change                                         | Location                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `requireMemberInOrg` before OpenRouter reclaim | `apps/server/src/routers/lambda/organization.ts` (`revokeMemberBudget`) |
| Budget load via `getMemberBudgetForOrg`        | `organization.ts` (`getMemberBudget`)                                   |
| `getMemberInOrg` / `getMemberBudgetForOrg`     | `packages/database/src/models/organization.ts`                          |
| Member UPDATE `WHERE` includes `orgId`         | `updateMemberRole`, `removeMember`                                      |
| Two-org `orgMemberId` swap regression          | `aico.rbacIdor.test.ts`                                                 |

---

## Retest results by finding

### TENANT-001 — Cross-tenant OpenRouter key disable via `revokeMemberBudget`

- **Status:** Fixed
- **Retest Result:** **Pass.** Org A manager calling `revokeMemberBudget` with Org B `orgMemberId` receives `NOT_FOUND` / `Member not found`. `reclaimMemberKey` is **not** invoked (asserted via mock). Membership is verified before any key side effect.

### TENANT-002 — Cross-tenant budget disclosure via `getMemberBudget`

- **Status:** Fixed
- **Retest Result:** **Pass.** Org A manager calling `getMemberBudget` with Org B `orgMemberId` returns `null`. Same-org budget read for Org B owner still returns funded budget metadata.

### TENANT-003 — `member_budgets` lack `orgId` column

- **Status:** Open (mitigated at API edge)
- **Retest Result:** **Partial.** Router/model edge now joins through `getMemberInOrg` / `getMemberBudgetForOrg`. Schema still has no denormalized `org_id` on `member_budgets`; defense-in-depth migration remains recommended, not blocking after TENANT-001/002 fix.

### TENANT-004 — Member UPDATE by PK only

- **Status:** Fixed
- **Retest Result:** **Pass (code review).** `updateMemberRole` and `removeMember` now `UPDATE ... WHERE id = ? AND org_id = ?`.

### TENANT-005 — Stub `orgAccess` module

- **Status:** Open
- **Retest Result:** Not in this fix scope.

### TENANT-006 / TENANT-007 / TENANT-008

- **Status:** Unchanged (Accepted Risk / Open as in parent report)
- **Retest Result:** N/A

### TENANT-009 — Missing two-org `orgMemberId` tests

- **Status:** Fixed
- **Retest Result:** **Pass.** New test `TENANT-001/002: Org A manager cannot read or revoke Org B member budget by orgMemberId swap` covers cross-tenant read + write; suite **16/16 passed**.

---

## Residual risk

1. Internal callers of `getMemberBudget(orgMemberId)` / `reclaimMemberKey(orgMemberId)` must still be reached only after an org join (trusted outbox / post-allocate paths). Prefer migrating call sites to `getMemberBudgetForOrg` over time (TENANT-003).
2. Platform admin cross-tenant power remains by design (TENANT-007).

---

## Definition of Done (retest)

| Criterion                                         | Status    |
| ------------------------------------------------- | --------- |
| Cross-tenant write (`revokeMemberBudget`) blocked | Pass      |
| Cross-tenant read (`getMemberBudget`) blocked     | Pass      |
| Regression test for Org A/B `orgMemberId` swap    | Pass      |
| Parent findings updated                           | See below |

Parent report finding statuses should be read as:

| ID                     | New status       |
| ---------------------- | ---------------- |
| TENANT-001             | Fixed            |
| TENANT-002             | Fixed            |
| TENANT-004             | Fixed            |
| TENANT-009             | Fixed            |
| TENANT-003             | Open (mitigated) |
| TENANT-005, TENANT-008 | Open             |
| TENANT-006, TENANT-007 | Accepted Risk    |
