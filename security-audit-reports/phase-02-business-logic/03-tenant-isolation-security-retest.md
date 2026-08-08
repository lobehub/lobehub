# Phase 02 — Tenant Isolation Security Retest (full closeout)

| Field             | Value                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| **Parent report** | `03-tenant-isolation-security.md`                                                                     |
| **Retest date**   | 2026-08-08                                                                                            |
| **Verification**  | `bun run check --test apps/server/src/routers/lambda/__tests__/aico.rbacIdor.test.ts` → **16 passed** |

---

## Round 1 (earlier)

| ID         | Result                                     |
| ---------- | ------------------------------------------ |
| TENANT-001 | Pass — `requireMemberInOrg` before reclaim |
| TENANT-002 | Pass — `getMemberBudgetForOrg`             |
| TENANT-004 | Pass — UPDATE includes `orgId`             |
| TENANT-009 | Pass — two-org swap regression             |

## Round 2 (this closeout)

| ID         | Result                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TENANT-003 | **Pass** — `member_budgets.org_id` column + migration `0141_aico_member_budgets_org_id.sql`; inserts/queries filter `orgId`+`orgMemberId`; `reclaimMemberKey({ orgId, orgMemberId })` |
| TENANT-005 | **Pass** — `orgAccess` re-exports real `auth/orgRole` (stub removed)                                                                                                                  |
| TENANT-008 | **Pass** — `getInvitePreview` returns NOT\_FOUND for non-pending or expired invites                                                                                                   |

## Residual / accepted

| ID         | Status                                                |
| ---------- | ----------------------------------------------------- |
| TENANT-006 | Accepted Risk — conversations not Aico-org-scoped     |
| TENANT-007 | Accepted Risk — platform admin cross-tenant by design |

## Kit

Extracted source prepared at:

`security-audit-reports/phase-02-business-logic/tenant-isolation-source/`

Vitest excludes `security-audit-reports/**`.
