# Phase 02 — Tenant Isolation Security Audit

| Field                 | Value                                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Audit area**        | Organization multi-tenancy isolation (IDOR / BOLA / cross-tenant)                                                                                                                            |
| **Phase**             | Phase 2 — Business Logic & Multi-Tenancy Security                                                                                                                                            |
| **Finding ID prefix** | `TENANT-xxx`                                                                                                                                                                                 |
| **Report path**       | `security-audit-reports/phase-02-business-logic/03-tenant-isolation-security.md`                                                                                                             |
| **Date**              | 2026-08-08                                                                                                                                                                                   |
| **Scope**             | Aico B2B Organization tenancy (`aicoOrganization` schema, `organization` / `aicoBilling` / `platformAdmin` tRPC, managed chat policy)                                                        |
| **Method**            | Static code review of routers, services, and DB models; ID-manipulation walkthrough against existing RBAC/IDOR tests; query-pattern review for missing `organizationId` / `orgId` predicates |
| **Out of scope**      | LobeHub Workspace tenancy (separate trust domain); Market “organization” accounts; live production traffic (no live Org A/B credentials in this session)                                     |

---

## Executive summary

Aico Organization isolation is **mostly enforced correctly** at the org boundary: strangers and plain members receive `FORBIDDEN` when substituting another organization’s `orgId`, and several write paths (`allocateMemberCredit`, `removeMember`, `assignMemberToTeam`, `setTeamModels`, invite revoke) join resource IDs with `orgId` in the database layer.

**Two confirmed Broken Object Level Authorization (BOLA) defects** remain on manager APIs that accept `orgMemberId` without proving that member belongs to the caller’s `orgId`:

1. **`organization.revokeMemberBudget`** — Critical cross-tenant **write** (disables another org’s OpenRouter key before membership is verified).
2. **`organization.getMemberBudget`** — High cross-tenant **read** (returns another org’s budget / key-presence metadata).

Existing automated tests cover stranger/`orgId` substitution and member-vs-manager RBAC, but **do not** cover manager-of-A + `orgMemberId`-of-B attacks.

**Verdict:** Cross-tenant manager `orgMemberId` gaps (TENANT-001/002) and follow-ups (TENANT-003/005/008) are **Fixed**. See `03-tenant-isolation-security-retest.md`. Remaining accepted risks: TENANT-006 (conversations), TENANT-007 (platform admin).

---

## Test environment (logical)

Isolation was reviewed as a two-tenant matrix consistent with the required setup:

| Actor    | Org A                                                   | Org B                       |
| -------- | ------------------------------------------------------- | --------------------------- |
| Owner    | Manager APIs allowed                                    | Must be denied on Org A IDs |
| Admin    | Manager APIs allowed                                    | Must be denied on Org A IDs |
| Member   | Manager APIs denied; spend only via own billing context | Must be denied on Org A IDs |
| Stranger | Denied on all Org A/B manager APIs                      | Denied                      |

Evidence sources:

- `apps/server/src/routers/lambda/organization.ts`
- `apps/server/src/routers/lambda/aicoBilling.ts`
- `apps/server/src/routers/lambda/platformAdmin.ts`
- `packages/database/src/models/organization.ts`
- `apps/server/src/services/aico/managedPolicy.ts`
- `apps/server/src/services/openrouter/keyService.ts`
- `apps/server/src/routers/lambda/__tests__/aico.rbacIdor.test.ts`

> **Note:** Aico enforces **at most one active organization membership per user** (`organization_members_unique_active_user_idx`). Concurrent dual-membership is not a realistic attack path; the realistic attacker is a manager of Org A who obtains (or guesses) an Org B `orgMemberId`.

---

## Resource coverage matrix

| Resource              | Primary APIs                                                       | Cross-tenant read                       | Cross-tenant write                                   | Notes                                                                           |
| --------------------- | ------------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| Organizations         | `getMine`, `create`, `getOrgWallet`, `getDashboard`                | Pass (membership / `requireOrgManager`) | Pass                                                 | Platform admin is intentional cross-tenant (TENANT-007)                         |
| Members               | `listMembers`, `updateMemberRole`, `removeMember`                  | Pass                                    | Pass (DB joins `memberId`+`orgId`)                   | Final UPDATE uses member PK only after prior join (TENANT-004)                  |
| Invitations           | `inviteMember`, `revokeInvite`, `acceptInvite`, `getInvitePreview` | Pass for org-scoped list/revoke         | Pass                                                 | Token possession is the capability (TENANT-008)                                 |
| Wallets               | `getOrgWallet`, `mockOrgTopup`, personal `getMyWallet`             | Pass                                    | Pass                                                 | Personal wallets are user-scoped, not org-scoped                                |
| Credits               | `allocateMemberCredit`, reclaim paths                              | Pass for allocate                       | Pass (`revokeMemberBudget` gated — TENANT-001 fixed) | Allocate verifies member ∈ org                                                  |
| Budgets               | `getMemberBudget`, dashboard stats                                 | Pass (TENANT-002/003 fixed)             | N/A for read API                                     | `member_budgets.org_id` + dual-key queries (TENANT-003)                         |
| Usage Reports         | `getDashboard`, `getMyUsage`                                       | Pass                                    | N/A                                                  | Dashboard lists only members of `orgId`; `getMyUsage` is caller `userId`        |
| Model Permissions     | `setTeamModels`, `listTeams`                                       | Pass                                    | Pass                                                 | `setTeamModelAccess` verifies `teamId`+`orgId`                                  |
| Organization Settings | status via platform admin; no separate org-settings router         | Pass for managers                       | Platform-only suspend/activate                       | No general org settings mutation for non-platform managers beyond teams/credits |
| Conversations         | Topics/sessions/messages                                           | N/A (not Aico-org-scoped)               | N/A                                                  | User/workspace ownership only (TENANT-006)                                      |
| OpenRouter Keys       | `keyService.*`, outbox                                             | Pass at manager edge                    | Pass — reclaim requires orgId                        | Keys never returned to SPA                                                      |
| Reports               | Dashboard / usage logs                                             | Pass for intended scopes                | N/A                                                  | No separate org-wide “reports” router beyond dashboard                          |

---

## ID manipulation checklist

| ID                          | Substituted across tenants?      | Expected                    | Observed (code review)                                             |
| --------------------------- | -------------------------------- | --------------------------- | ------------------------------------------------------------------ |
| `organizationId` / `orgId`  | Yes                              | Reject non-members          | Reject via `requireOrgManager` / `getMemberRole`                   |
| `userId`                    | Yes (platform / soft-delete)     | Self or platform only       | Platform-gated; soft-delete uses authenticated account path        |
| `memberId` / `orgMemberId`  | Yes                              | Must belong to same `orgId` | **Broken** on `getMemberBudget` / `revokeMemberBudget`             |
| `walletId`                  | N/A as client input              | —                           | Org wallet loaded by `orgId`; personal by `ctx.userId`             |
| `invitationId` / `inviteId` | Yes                              | Join with `orgId`           | Pass (`revokeInvite`)                                              |
| `usageId`                   | Not exposed as org manager input | —                           | Usage listed by `userId` or aggregated in dashboard by org members |
| `conversationId`            | Workspace/user domain            | Ownership checks            | Not Aico-org tenant-scoped                                         |

---

## Positive controls (passed)

1. **`requireOrgManager`** on nearly all org manager procedures; strangers/members denied (`aico.rbacIdor.test.ts`).
2. **`AicoManagedPolicy.authorize`** fails closed: forged `{ source: 'organization', organizationId: OrgB }` without membership → `ORG_MEMBERSHIP_REQUIRED`.
3. **`allocateMemberCredit` / `reclaimMemberRemainingCredit` / `assignMemberToTeam` / `deleteTeam` / `setTeamModelAccess` / `revokeInvite` / `removeMember`** verify resource ∈ `orgId` in SQL.
4. Billing preference (`setBillingPreference`) checks membership and is documented as non-authorizing for chat.
5. Invite tokens stripped from `listMembers`; OpenRouter key material not returned to SPA.
6. Suspended orgs excluded from active membership listing used by chat.

---

## Findings

### TENANT-001 — Cross-tenant OpenRouter key disable via `revokeMemberBudget`

- **Finding ID:** TENANT-001

- **Title:** BOLA: Org A manager can disable Org B member OpenRouter key by substituting `orgMemberId`

- **Severity:** Critical

- **Status:** Fixed

- **Affected Component:** `apps/server/src/routers/lambda/organization.ts` (`revokeMemberBudget`); `apps/server/src/services/openrouter/keyService.ts` (`reclaimMemberKey`); `packages/database/src/models/organization.ts` (`getMemberBudget`)

- **Description:**\
  `revokeMemberBudget` only checks that the caller manages `input.orgId`. It then calls `keyService.reclaimMemberKey(input.orgMemberId)`, which loads the budget **by `orgMemberId` alone** and disables the OpenRouter key **before** proving that the member belongs to `input.orgId`.\
  `reclaimMemberRemainingCredit` later correctly joins `orgMemberId`+`orgId` and throws `MEMBER_NOT_FOUND`, so credit is not credited to the attacker’s org — but the remote key disable has already occurred.

```315:331:apps/server/src/routers/lambda/organization.ts
  revokeMemberBudget: orgProcedure
    .input(z.object({ orgId: z.string().min(1), orgMemberId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);

      const keyService = new AicoOpenRouterKeyService(ctx.serverDB);
      const reclaimed = await keyService.reclaimMemberKey(input.orgMemberId);
      // ...
      const result = await ctx.organizationModel.reclaimMemberRemainingCredit({
        orgId: input.orgId,
        orgMemberId: input.orgMemberId,
        // ...
      });
```

```217:231:apps/server/src/services/openrouter/keyService.ts
  reclaimMemberKey = async (orgMemberId: string) => {
    const budget = await this.orgModel.getMemberBudget(orgMemberId);
    if (!budget?.openrouterKeyId) return null;
    // ...
    await this.client.updateKey({ disabled: true, hash: budget.openrouterKeyId });
```

- **Attack Scenario:**\
  Manager of Organization A obtains Organization B’s `orgMemberId` (support ticket, log, shared screen, leaked API response, etc.) and calls `revokeMemberBudget` with `orgId = A` and `orgMemberId = B_member`. Org B member’s managed key is disabled; Org B spend fails until operators recover.

- **Reproduction Steps:**
  1. Create Organization A (Owner/Admin) and Organization B with an allocated member budget + OpenRouter key.
  2. As Org A manager, record Org A `orgId` and Org B target `orgMemberId`.
  3. Call tRPC `organization.revokeMemberBudget` with `{ orgId: <OrgA>, orgMemberId: <OrgB_member> }`.
  4. Observe OpenRouter key for Org B member disabled (or mock `updateKey` invoked with Org B’s `openrouterKeyId`).
  5. Observe subsequent credit reclaim failing with `MEMBER_NOT_FOUND` / error path — key already disabled.

- **Impact:** Cross-tenant denial of service against managed model access; billing integrity disruption for the victim org; violates absolute tenant isolation requirement. Severity Critical due to destructive cross-tenant write.

- **Recommendation:**
  1. Before any key/budget side effect, assert membership:\
     `organization_members.id = orgMemberId AND org_id = orgId` (active or allowed statuses).
  2. Prefer a single transactional helper `reclaimMemberBudget({ orgId, orgMemberId })` that refuses foreign members with `NOT_FOUND`/`FORBIDDEN` **without** calling OpenRouter.
  3. Add regression test: Org A manager + Org B `orgMemberId` must not call `updateKey` / must reject.
  4. Optionally add `org_id` to `member_budgets` and filter every budget/key query by it (see TENANT-003).

- **Retest Result:** Pass — membership asserted before OpenRouter reclaim; see `03-tenant-isolation-security-retest.md`.

---

### TENANT-002 — Cross-tenant budget disclosure via `getMemberBudget`

- **Finding ID:** TENANT-002

- **Title:** IDOR: Org A manager can read Org B member budget metadata by substituting `orgMemberId`

- **Severity:** High

- **Status:** Fixed

- **Affected Component:** `apps/server/src/routers/lambda/organization.ts` (`getMemberBudget`); `packages/database/src/models/organization.ts` (`getMemberBudget`)

- **Description:**\
  After `requireOrgManager(orgId)`, the procedure loads `getMemberBudget(orgMemberId)` with **no** join ensuring the member belongs to that org. A manager of Org A can read another tenant’s period amounts, reserved/settled usage, renewal status, and whether a managed key exists.

```604:625:apps/server/src/routers/lambda/organization.ts
  getMemberBudget: orgProcedure
    .input(z.object({ orgId: z.string().min(1), orgMemberId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireOrgManager(ctx.organizationModel, ctx.userId, input.orgId);
      const budget = await ctx.organizationModel.getMemberBudget(input.orgMemberId);
      if (!budget) return null;
      return {
        // period amounts, reserved/settled, hasManagedKey, renewalStatus, ...
      };
    }),
```

```879:882:packages/database/src/models/organization.ts
  getMemberBudget = async (orgMemberId: string) => {
    return this.db.query.memberBudgets.findFirst({
      where: eq(memberBudgets.orgMemberId, orgMemberId),
    });
  };
```

- **Attack Scenario:** Org A admin enumerates or obtains Org B `orgMemberId` values and polls budgets to map spend, renewal cadence, and key provisioning state of a competitor tenant.

- **Reproduction Steps:**
  1. Create Org A (manager) and Org B with a funded member budget.
  2. As Org A manager, call `organization.getMemberBudget({ orgId: OrgA, orgMemberId: OrgB_member })`.
  3. Observe non-null budget fields for Org B (amounts, `hasManagedKey`, periods) instead of `null` / `FORBIDDEN` / `NOT_FOUND`.

- **Impact:** Cross-tenant confidentiality breach of financial and operational metadata. High (not Critical: no direct key secret returned, but budget economics and key presence leak).

- **Recommendation:**
  1. Resolve member with `id + orgId` first; only then load budget.
  2. Return `null`/`NOT_FOUND` for foreign members (avoid oracle that distinguishes “wrong org” vs “no budget” if product allows; at minimum never return foreign budget rows).
  3. Add IDOR regression test alongside TENANT-001.

- **Retest Result:** Pass — `getMemberBudgetForOrg` returns null for foreign `orgMemberId`; see retest report.

---

### TENANT-003 — `member_budgets` (and key helpers) lack tenant predicate in schema/API

- **Finding ID:** TENANT-003

- **Title:** Defense-in-depth gap: tenant resources keyed only by `orgMemberId` without `orgId`

- **Severity:** Medium

- **Status:** Fixed

- **Affected Component:** `packages/database/src/schemas/aicoOrganization.ts` (`member_budgets`); `OrganizationModel.getMemberBudget` / `syncMemberBudgetUsage` / `updateMemberOpenRouterKey`; `AicoOpenRouterKeyService` methods keyed solely by `orgMemberId`

- **Description:**\
  `member_budgets` references `organization_members` but has **no `org_id` column**. Isolation therefore depends on every caller joining through membership. Router-edge mistakes (TENANT-001/002) become exploitable because the data layer cannot enforce `WHERE id = ? AND organizationId = ?` style predicates on budgets/keys.

- **Attack Scenario:** Any future procedure that accepts `orgMemberId` after only checking caller role on a different `orgId` inherits the same class of BOLA.

- **Reproduction Steps:**
  1. Inspect schema: `member_budgets` columns — confirm no `org_id`.
  2. Grep model/key service for `getMemberBudget(orgMemberId)` call sites without a preceding `orgId` membership assertion.
  3. Confirm TENANT-001/002 exploit paths rely on this pattern.

- **Impact:** Systemic amplification of object-level auth bugs; harder to review and harder to express correct SQL constraints.

- **Recommendation:**
  1. Add denormalized `org_id` (FK) on `member_budgets` (and consider outbox already has `orgId` — keep consistent).
  2. Change helpers to `getMemberBudget({ orgId, orgMemberId })` and enforce both in SQL.
  3. Treat “id-only” budget/key APIs as internal-only and unsafe at HTTP/tRPC edges.

- **Retest Result:** Pass — `org_id` on `member_budgets` + migration 0141; reclaim requires `{ orgId, orgMemberId }`.

---

### TENANT-004 — Member role/remove final UPDATE filtered by member PK only

- **Finding ID:** TENANT-004

- **Title:** Narrow TOCTOU: `updateMemberRole` / `removeMember` update by `organization_members.id` after org join check

- **Severity:** Low

- **Status:** Fixed

- **Affected Component:** `packages/database/src/models/organization.ts` (`updateMemberRole`, `removeMember`)

- **Description:**\
  Both methods first `SELECT` with `id + orgId`, then `UPDATE ... WHERE id = memberId` without repeating `orgId`. Under normal ID uniqueness this is safe; a theoretical race would require the membership row’s `org_id` to change between SELECT and UPDATE (not supported by product flows today).

- **Attack Scenario:** Only relevant if membership rows could move across orgs in-place (they cannot today) or if IDs were reused (they are not).

- **Reproduction Steps:** Code inspection of `updateMemberRole` / `removeMember` update clauses.

- **Impact:** Low residual risk; defense-in-depth inconsistency with safer join patterns used elsewhere.

- **Recommendation:** Repeat `and(eq(id), eq(orgId))` (and status constraints) on the UPDATE `WHERE` clause.

- **Retest Result:** Pass — UPDATE `WHERE` now includes `orgId`.

---

### TENANT-005 — Dead stub `orgAccess` module can silently break future authz

- **Finding ID:** TENANT-005

- **Title:** Stub `getCurrentOrgRole` / `isPlatformAdmin` always deny — confusion risk with real `auth/orgRole`

- **Severity:** Medium

- **Status:** Fixed

- **Affected Component:** `apps/server/src/services/orgAccess/index.ts` (stub); real implementation in `apps/server/src/services/auth/orgRole.ts`

- **Description:**\
  `orgAccess` always returns `null` / `false`. No current imports were found, so this is not an active bypass. If future code imports the stub instead of `auth/orgRole`, managers would be denied (fail-closed) or platform checks would fail closed — availability/ops risk rather than cross-tenant read. The opposite mistake (assuming stub “allows”) is documented in comments as temporary wiring, which is misleading.

- **Attack Scenario:** Developer wires a new router to the stub; platform or org gates behave incorrectly (most likely fail-closed). Lower likelihood of privilege escalation unless someone “fixes” the stub to return permissive defaults.

- **Reproduction Steps:** Open `apps/server/src/services/orgAccess/index.ts`; confirm stub behavior; confirm no imports; compare with `auth/orgRole.ts`.

- **Impact:** Maintenance hazard that can regress authorization correctness.

- **Recommendation:** Delete the stub or re-export the real `auth/orgRole` helpers; add a lint/test forbidding the stub path.

- **Retest Result:** Pass — stub replaced with re-export of `auth/orgRole`.

---

### TENANT-006 — Conversations are not Organization-tenant scoped

- **Finding ID:** TENANT-006

- **Title:** Chat conversations/topics are user/workspace-owned, not Aico Organization-isolated

- **Severity:** Informational

- **Status:** Accepted Risk (product design) — confirm with product if org offboarding must revoke chat history

- **Affected Component:** Topic/session/message models; absence of `organizationId` on conversation entities

- **Description:**\
  Aico Organization tenancy gates **billing, keys, membership, teams, and model allow-lists**. Conversation content remains under user/workspace ownership. Leaving or being removed from an org does not, by itself, purge or re-ACL historical chats that the user authored.

- **Attack Scenario:** User leaves Org A; still reads their past topics that were created while spending Org A credits (content retention), without accessing Org A wallet/members.

- **Reproduction Steps:** Confirm no `organizationId` FK on topics/sessions used by chat; confirm `AicoManagedPolicy` only gates spend, not topic CRUD.

- **Impact:** Not a classic cross-tenant IDOR between Org A and Org B managers over each other’s member lists/wallets. Residual data-governance concern for enterprises that expect org-owned chat corpora.

- **Recommendation:** Document clearly in security/product docs. If org-owned chats are required, add org ACL or export/delete-on-revoke workflows as a separate feature.

- **Retest Result:** N/A (design acceptance pending product confirmation).

---

### TENANT-007 — Platform admin intentional cross-tenant superuser

- **Finding ID:** TENANT-007

- **Title:** `platformAdmin` and `requireOrgManager` platform bypass grant full cross-tenant power

- **Severity:** Informational (Accepted Risk with controls)

- **Status:** Accepted Risk

- **Affected Component:** `apps/server/src/routers/lambda/platformAdmin.ts`; `requireOrgManager` platform short-circuit; `platform_admins` table

- **Description:**\
  Platform admins can list orgs, credit wallets, suspend orgs (disabling all member keys), and are treated as org `owner` inside `requireOrgManager`. This is by design for B2B operations but is a single-point breakout if `platform_admins` is compromised.

- **Attack Scenario:** Stolen platform admin session → full cross-tenant read/write.

- **Reproduction Steps:** Non-platform users are denied (`aico.rbacIdor.test.ts`); platform users succeed on `listOrganizations` / credit / suspend.

- **Impact:** Expected privileged path. Compromise impact is Critical operationally; control risk is Accepted with monitoring.

- **Recommendation:** Keep `addPlatformAdmin` tightly gated; audit log all platform financial/suspension actions; prefer break-glass accounts; consider step-up auth.

- **Retest Result:** N/A — accepted design.

---

### TENANT-008 — Invite preview capability equals token possession

- **Finding ID:** TENANT-008

- **Title:** Any authenticated user with invite token can preview org name and role

- **Severity:** Low

- **Status:** Fixed

- **Affected Component:** `organization.getInvitePreview` / `acceptInvite`

- **Description:**\
  Preview does not require prior membership; possession of the invite token reveals `orgName`, `role`, expiry, and identifier type. Accept still enforces identifier match. This is common invite UX but means token leak is invite abuse + limited org metadata disclosure.

- **Attack Scenario:** Token leaked via URL logs/Referer → attacker previews org name and attempts accept (blocked if identifier mismatch).

- **Reproduction Steps:** Call `getInvitePreview` with a valid token as an unrelated authenticated user.

- **Impact:** Limited metadata disclosure; invite abuse if identifier can be satisfied.

- **Recommendation:** Short TTL (already 3 days), single-use, avoid putting raw tokens in query logs; rate-limit preview; consider binding preview to invited email session when possible.

- **Retest Result:** Pass — preview rejects non-pending/expired invites.

---

### TENANT-009 — Missing automated tests for cross-tenant `orgMemberId` substitution

- **Finding ID:** TENANT-009

- **Title:** RBAC/IDOR suite does not cover manager-of-A + member-of-B object ID swaps

- **Severity:** Medium

- **Status:** Fixed

- **Affected Component:** `apps/server/src/routers/lambda/__tests__/aico.rbacIdor.test.ts`

- **Description:**\
  Existing tests prove strangers cannot swap `orgId` and members cannot call manager APIs. They do **not** create two orgs and attempt `getMemberBudget` / `revokeMemberBudget` with mismatched `orgMemberId`. That gap allowed TENANT-001/002 to persist despite Phase 2 IDOR work.

- **Attack Scenario:** Regressions of the same class ship unnoticed.

- **Reproduction Steps:** Review `aico.rbacIdor.test.ts` — no two-org `orgMemberId` mismatch cases for budget revoke/read.

- **Impact:** Detection failure for Critical/High tenant bugs.

- **Recommendation:** Add dedicated tests for TENANT-001/002 as mandatory release gates; extend matrix to `assignMemberToTeam` / `allocateMemberCredit` foreign IDs (expect deny — already DB-enforced).

- **Retest Result:** Pass — two-org swap test added; suite 16/16 passed.

| Pattern                                                | Location                                                                                                                                                        | Tenant-safe?                                               |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `WHERE org_id = ? AND id = ?` on members/teams/invites | `removeMember`, `updateMemberRole` (select), `revokeInvite`, `assignMemberToTeam`, `setTeamModelAccess`, `allocateMemberCredit`, `reclaimMemberRemainingCredit` | Yes                                                        |
| `WHERE org_member_id = ?` only on `member_budgets`     | `getMemberBudget`, key reclaim/sync                                                                                                                             | **No** at trust boundary (TENANT-001–003)                  |
| `UPDATE organization_members SET ... WHERE id = ?`     | After prior org join                                                                                                                                            | Acceptable with TENANT-004 hardening                       |
| `usage_logs` / `wallet_transactions` by `userId`       | `aicoBilling` personal APIs                                                                                                                                     | Yes for self; do not expose as org-wide without org filter |
| Platform queries by arbitrary `orgId`                  | `platformAdmin`                                                                                                                                                 | Intentional (TENANT-007)                                   |

**Required pattern for tenant resources at the API edge:**

```sql
WHERE id = ? AND organization_id = ?
-- or for member-scoped rows:
WHERE org_member_id = ? AND org_id = ?
```

---

## Cross-tenant read / write summary

| Class                                                   | Result                            |
| ------------------------------------------------------- | --------------------------------- |
| Cross-tenant **read** via `orgId` swap (stranger)       | **Blocked**                       |
| Cross-tenant **read** via `orgMemberId` swap (manager)  | **Blocked** (fixed — TENANT-002)  |
| Cross-tenant **write** via `orgId` swap (stranger)      | **Blocked**                       |
| Cross-tenant **write** via `orgMemberId` swap (manager) | **Blocked** (fixed — TENANT-001)  |
| Chat billing context forge for foreign org              | **Blocked** (`AicoManagedPolicy`) |
| Member horizontal escalation to manager APIs            | **Blocked**                       |

---

## Definition of Done checklist

| Criterion                                              | Status                                            |
| ------------------------------------------------------ | ------------------------------------------------- |
| At least two Organizations tested (logical A/B matrix) | Done                                              |
| All tenant-scoped APIs reviewed                        | Done (matrix above)                               |
| ID manipulation performed (code-level attack paths)    | Done                                              |
| Database queries reviewed                              | Done                                              |
| Cross-tenant write tested                              | Done — initially fail TENANT-001; **retest Pass** |
| Cross-tenant read tested                               | Done — initially fail TENANT-002; **retest Pass** |
| Report stored under `security-audit-reports/`          | Done                                              |
| Retest report                                          | `03-tenant-isolation-security-retest.md`          |

---

## Priority remediation plan

1. ~~**P0:** Fix TENANT-001~~ Done.
2. ~~**P0:** Fix TENANT-002~~ Done.
3. ~~**P1:** Schema/helper hardening TENANT-003~~ Done (`0141_aico_member_budgets_org_id`).
4. ~~**P2:** TENANT-004 / TENANT-005~~ Done.
5. ~~**P3:** TENANT-008 invite preview hygiene~~ Done. TENANT-006/007 remain Accepted Risk.

Retest document: `03-tenant-isolation-security-retest.md`.

---

## References

- OWASP API Security Top 10 — API1 Broken Object Level Authorization
- Internal prior notes: `AICO_PHASE1_AUDIT.md`, `AICO_PHASE2_TEST_REPORT.md` (orgId stranger IDOR marked pass; object-level `orgMemberId` gap not closed)
- Primary code: `apps/server/src/routers/lambda/organization.ts`, `packages/database/src/models/organization.ts`, `apps/server/src/services/aico/managedPolicy.ts`
