# Authorization & Role Security Audit

| Field               | Value                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Plane**           | [AICO-104](https://plane.panafor.com/panaforai/browse/AICO-104/)                                                                  |
| **Phase**           | Phase 1 — Identity & Access Security                                                                                              |
| **Finding prefix**  | AUTHZ-001 …                                                                                                                       |
| **Audit date**      | 2026-08-10                                                                                                                        |
| **Baseline commit** | `bd2864ade8cb7cdcda9350a72f5ade3466251e74` (`canary`)                                                                             |
| **Method**          | Static code review + existing regression test analysis                                                                            |
| **Scope**           | AICO org RBAC (`organization.*`, `aicoBilling.*`, `platformAdmin.*`), supporting models, DB constraints, OSS workspace RBAC stubs |

---

## 1. Executive summary

AICO organization authorization is **enforced on the backend** through dedicated tRPC guards (`requireOrgManager`, `requireOrgOwner`, `platformProcedure`) rather than UI-only checks. Privilege-escalation paths called out in AICO-104 (member self-promotion, org admin → platform admin, self-serve credit minting) are **blocked** in the current codebase.

**Verdict:** Acceptable for AICO org/billing surfaces with one functional gap and two process/deployment caveats documented below.

| Severity      | Open |                    Closed / Accepted |
| ------------- | ---: | -----------------------------------: |
| Critical      |    0 |                                    0 |
| High          |    0 | 1 (conditional — OSS workspace RBAC) |
| Medium        |    1 |                                    0 |
| Low           |    1 |                                    0 |
| Informational |    1 |                                    2 |

Primary action items:

1. **AUTHZ-001** — Fix atomic owner transfer in `updateMemberRole`.
2. **AUTHZ-004** — Add privilege-escalation regression tests to `aico.rbacIdor.test.ts`.
3. Confirm production deploys cloud RBAC overrides if LobeHub workspace APIs are exposed (**AUTHZ-003**).

---

## 2. Role model

| Audit role                          | Implementation                         | Storage                                               |
| ----------------------------------- | -------------------------------------- | ----------------------------------------------------- |
| Org Owner                           | `organization_members.role = 'owner'`  | `organization_members`, `organizations.owner_user_id` |
| Org Admin                           | `organization_members.role = 'admin'`  | `organization_members`                                |
| Org Member                          | `organization_members.role = 'member'` | `organization_members`                                |
| Platform Admin                      | Row in `platform_admins`               | `platform_admins`                                     |
| LobeHub Super Admin                 | Global RBAC `super_admin`              | `rbac_user_roles` (workspace\_id IS NULL)             |
| Workspace Owner/Admin/Member/Viewer | LobeHub workspace RBAC                 | `workspace_members`, `packages/const/src/rbac.ts`     |

Enforcement entry points:

- `apps/server/src/routers/lambda/organization.ts` — org manager/owner gates
- `apps/server/src/routers/lambda/aicoBilling.ts` — personal wallet + billing preference
- `apps/server/src/routers/lambda/platformAdmin.ts` — platform-only mutations
- `apps/server/src/routers/lambda/index.ts` — **platformAdmin router intentionally not mounted** on product lambda

---

## 3. Permission matrix (AICO org)

Legend: ✅ allowed · ❌ denied · 🔒 owner-only · 🛡 platform-admin-only · — not applicable

| Action                                    | Org Member | Org Admin | Org Owner |      Platform Admin      |
| ----------------------------------------- | :--------: | :-------: | :-------: | :----------------------: |
| Invite member (`admin` / `member`)        |     ❌     |    ✅     |    ✅     |           ✅¹            |
| Remove member (non-owner)                 |     ❌     |    ✅     |    ✅     |           ✅¹            |
| Change member role → `admin`/`member`     |     ❌     |    ✅     |    ✅     |           ✅¹            |
| Transfer ownership → `owner`              |     ❌     |    ❌²    |    ⚠️³    | ✅ (via `assignManager`) |
| Change member budget / allocate credit    |     ❌     |    ✅     |    ✅     |           ✅¹            |
| Change model permission (`setTeamModels`) |     ❌     |    ✅     |    ✅     |           ✅¹            |
| View org usage / dashboard / wallet       |     ❌     |    ✅     |    ✅     |           ✅¹            |
| Organization settings (teams, invites)    |     ❌     |    ✅     |    ✅     |           ✅¹            |
| Delete organization                       |     ❌     |    ❌     |    🔒     |           ❌⁴            |
| Personal wallet read (`getMyWallet`)      |     ✅     |    ✅     |    ✅     |            ✅            |
| Set billing preference                    |    ✅⁵     |    ✅⁵    |    ✅⁵    |           ✅⁵            |
| Add org / user credit                     |     ❌     |    ❌     |    ❌     |            🛡             |
| Suspend / activate org                    |     ❌     |    ❌     |    ❌     |            🛡             |
| Add platform admin                        |     ❌     |    ❌     |    ❌     |            🛡             |
| Super-admin API (`platformAdmin.*`)       |     ❌     |    ❌     |    ❌     |            🛡             |

¹ Platform admin passes `requireOrgManager` as synthetic `'owner'` — full manager access on any org except delete.

² Router blocks `role: 'owner'` unless caller is owner or platform admin (`organization.ts:362-367`).

³ Owner may call `updateMemberRole` with `role: 'owner'`, but model lacks atomic handoff — see **AUTHZ-001**.

⁴ `requireOrgOwner` explicitly excludes platform admins from soft-delete path.

⁵ Requires active org membership when `source = 'organization'`.

---

## 4. Security checks (AICO-104 checklist)

| Check                                     | Result     | Evidence                                                             |
| ----------------------------------------- | ---------- | -------------------------------------------------------------------- |
| Authorization enforced in backend         | ✅ Pass    | `requireOrgManager`, `requireOrgOwner`, `platformProcedure`          |
| Restrictions not UI-only                  | ✅ Pass    | tRPC throws `FORBIDDEN` before model mutations                       |
| Member cannot self-promote to admin/owner | ✅ Pass    | `requireOrgManager` on all role/budget/model mutations               |
| Member cannot become owner                | ✅ Pass    | Same gate + router blocks non-owner from setting `role: 'owner'`     |
| Org admin cannot become platform admin    | ✅ Pass    | `addPlatformAdmin` is `platformProcedure`; no self-service path      |
| Owner cannot become platform admin (self) | ✅ Pass    | Same — requires existing platform admin                              |
| Member cannot change own budget           | ✅ Pass    | `allocateMemberCredit` requires manager                              |
| Member cannot change own model permission | ✅ Pass    | `setTeamModels` / team assignment require manager                    |
| Member cannot add credit                  | ✅ Pass    | No member-facing credit mutation                                     |
| Org admin cannot create credit            | ✅ Pass    | `addManualCredit` platform-only; mock top-up removed                 |
| Super-admin API platform-only             | ✅ Pass    | Router not mounted on product lambda; `platformProcedure` gate       |
| Mass assignment reviewed                  | ⚠️ See §5  | Org endpoints scoped; user profile uses field-specific procedures    |
| Privilege escalation tested               | ⚠️ Partial | IDOR suite strong; vertical escalation tests missing (**AUTHZ-004**) |

---

## 5. Mass assignment review

### AICO org routers — ✅ Well scoped

All `organization.*` and `aicoBilling.*` mutations accept explicit Zod schemas. Sensitive fields are **not** present on generic update DTOs:

| Field                        | Client writable?                 | Notes                                                                    |
| ---------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `role`                       | Dedicated endpoints only         | Enum `'owner' \| 'admin' \| 'member'` or `'admin' \| 'member'` on invite |
| `organizationId` / `orgId`   | Required + membership re-checked | Cross-tenant IDOR mitigated (`requireMemberInOrg`)                       |
| `balance` / wallet fields    | ❌                               | Model-internal only (`addManualCredit`, `allocateMemberCredit`)          |
| `budget`                     | ❌                               | Via manager-only allocate/revoke                                         |
| `isAdmin` / platform admin   | ❌                               | `platform_admins` table; API is platform-only                            |
| `permissions` / model access | Manager-only                     | `setTeamModels`                                                          |

Example — billing preference validates membership but does not accept balance/role:

```204:226:apps/server/src/routers/lambda/aicoBilling.ts
  setBillingPreference: billingProcedure
    .input(
      z.object({
        organizationId: z.string().min(1).optional(),
        source: z.enum(['personal', 'organization']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.source === 'organization') {
        // ...
        const role = await ctx.organizationModel.getMemberRole(ctx.userId, input.organizationId);
        if (!role) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'ORG_MEMBERSHIP_REQUIRED' });
        }
      }
      const wallet = await ctx.billingModel.setBillingPreference({ /* ... */ });
```

### User profile (`user.*`) — ✅ Field-specific procedures

`UserModel.updateUser` accepts `Partial<UserItem>`, but tRPC exposes **narrow** mutations (`updateFullName`, `updateUsername`, `updateSettings`, etc.) — no generic "update any column" endpoint from the client.

### OpenAPI user/role routes — ℹ️ Out of AICO scope

`packages/openapi/src/routes/users.route.ts` accepts `roleIds` on create/update, gated by RBAC permission resolution. Separate attack surface from AICO org billing; recommend Phase 1 follow-up if OpenAPI is exposed to AICO tenants.

---

## 6. Sensitive actions — test matrix

Static verification + mapping to `apps/server/src/routers/lambda/__tests__/aico.rbacIdor.test.ts`.

| Action                  | Procedure                      | Member | Stranger | Manager | Platform | Automated test        |
| ----------------------- | ------------------------------ | :----: | :------: | :-----: | :------: | --------------------- |
| Invite member           | `inviteMember`                 |   ❌   |    ❌    |   ✅    |    ✅    | Partial (invite flow) |
| Remove member           | `removeMember`                 |   ❌   |    ❌    |   ✅    |    ✅    | —                     |
| Change role             | `updateMemberRole`             |   ❌   |    ❌    |  ✅\*   |    ✅    | —                     |
| Change budget           | `allocateMemberCredit`         |   ❌   |    ❌    |   ✅    |    ✅    | ✅ IDOR deny          |
| Change model permission | `setTeamModels`                |   ❌   |    ❌    |   ✅    |    ✅    | —                     |
| View usage              | `getOrgUsageChart`, etc.       |   ❌   |    ❌    |   ✅    |    ✅    | ✅ IDOR deny          |
| Org settings            | `listTeams`, `createTeam`, …   |   ❌   |    ❌    |   ✅    |    ✅    | —                     |
| Wallet management       | `getOrgWallet`, `getDashboard` |   ❌   |    ❌    |   ✅    |    ✅    | ✅ IDOR deny          |
| Credit management       | `addManualCredit`              |   ❌   |    ❌    |   ❌    |    ✅    | ✅ FORBIDDEN          |
| Super admin ops         | `platformAdmin.*`              |   ❌   |    ❌    |   ❌    |    ✅    | ✅ FORBIDDEN          |

\* Admin cannot set `role: 'owner'` without owner/platform admin (**router gate**).

Existing regression coverage (14 cases in `aico.rbacIdor.test.ts`):

- AICO-P1-001/002 — mock top-up procedures removed
- Member IDOR deny on list/wallet/allocate/usage
- Stranger orgId substitution blocked
- TENANT-001/002 cross-tenant budget read/write
- Non-platform user blocked from all `platformAdmin` mutations
- Phone verification gate for org create (AICO-P1-023)
- Invite token not leaked via `listMembers` (AICO-P1-026)
- `getInviteLink` manager-only (AICO-92)

---

## 7. Findings

### AUTHZ-001 — Owner transfer via `updateMemberRole` is not atomic

| Field                  | Value                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | Medium                                                                                                                                                                                                                                                                                                                                                                  |
| **Status**             | Open                                                                                                                                                                                                                                                                                                                                                                    |
| **Affected component** | `OrganizationModel.updateMemberRole`, `organization.updateMemberRole`                                                                                                                                                                                                                                                                                                   |
| **Description**        | Promoting a member to `owner` through `updateMemberRole` updates only the target row. It does **not** demote the incumbent owner or update `organizations.owner_user_id`.                                                                                                                                                                                               |
| **Attack scenario**    | Org owner attempts legitimate ownership transfer to another member via product UI. Operation fails when the partial unique index `organization_members_unique_active_owner_idx` rejects a second active owner. No privilege gain, but broken business flow and opaque `BAD_REQUEST` / DB error.                                                                         |
| **Reproduction steps** | 1. Create org as User A (owner). 2. Invite User B as member. 3. As User A, call `organization.updateMemberRole({ orgId, memberId: B, role: 'owner' })`. 4. Observe failure while User A remains sole owner. Compare with `platformAdmin.assignManager({ role: 'owner' })` which correctly demotes prior owner in a transaction (`organization.ts` model lines 480-497). |
| **Impact**             | Ownership transfer broken on product path; potential support burden; platform-admin path behaves differently. DB constraint prevents dual-owner inconsistency (fail-closed).                                                                                                                                                                                            |
| **Recommendation**     | Mirror `assignManager` transaction logic inside `updateMemberRole` when `role === 'owner'`: update `organizations.owner_user_id`, demote previous owner to `admin`, then promote target. Add regression test.                                                                                                                                                           |
| **Retest result**      | —                                                                                                                                                                                                                                                                                                                                                                       |

---

### AUTHZ-002 — Platform admin org-manager bypass (accepted design)

| Field                  | Value                                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Severity**           | Informational                                                                                                                                                                                                                              |
| **Status**             | Accepted Risk                                                                                                                                                                                                                              |
| **Affected component** | `requireOrgManager` in `organization.ts`                                                                                                                                                                                                   |
| **Description**        | Platform admins pass `requireOrgManager` as synthetic `'owner'`, granting manager-level access to **any** organization (list members, allocate budget, change roles, etc.). Only `deleteOrganization` excludes them via `requireOrgOwner`. |
| **Attack scenario**    | Compromised platform-admin account can manage all tenant orgs.                                                                                                                                                                             |
| **Impact**             | By design for control-plane operations; blast radius equals platform admin tier.                                                                                                                                                           |
| **Recommendation**     | Maintain strict platform-admin provisioning (**AUTHZ-005** closed). Ensure `recordAicoSecurityEvent` retention and alerting on `platform.*` / cross-org `org.*` actions.                                                                   |
| **Retest result**      | N/A — accepted                                                                                                                                                                                                                             |

---

### AUTHZ-003 — OSS workspace RBAC middleware is a no-op

| Field                  | Value                                                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | High (conditional — OSS / self-hosted LobeHub workspace APIs)                                                                                                                                                          |
| **Status**             | Accepted Risk (AICO-only deploys) / Open (full product)                                                                                                                                                                |
| **Affected component** | `packages/business-server/src/trpc-middlewares/rbacPermission.ts`, `workspaceAuth.ts`                                                                                                                                  |
| **Description**        | `withScopedPermission`, `withRbacPermission`, and `requireWorkspaceRoleWhenScoped` are explicit no-ops in OSS builds. Routers still import these middlewares; real enforcement requires cloud tsconfig path overrides. |
| **Attack scenario**    | Self-hosted deployment without cloud overrides: any authenticated user passes workspace permission gates on topic, agent, document, etc.                                                                               |
| **Impact**             | No effect on AICO org/billing routers (they use dedicated guards). Critical if workspace collaboration APIs are exposed.                                                                                               |
| **Recommendation**     | Document deployment requirement. For self-hosted Aico-only builds, confirm workspace routers are not reachable. For full LobeHub, ship cloud RBAC override or port real middleware to OSS.                             |
| **Retest result**      | N/A for AICO org scope                                                                                                                                                                                                 |

---

### AUTHZ-004 — Missing privilege-escalation regression tests

| Field                  | Value                                                                                                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | Low                                                                                                                                                                                                                         |
| **Status**             | Open                                                                                                                                                                                                                        |
| **Affected component** | `apps/server/src/routers/lambda/__tests__/aico.rbacIdor.test.ts`                                                                                                                                                            |
| **Description**        | Existing suite covers horizontal IDOR and platform-admin gate well, but does not assert vertical escalation paths listed in AICO-104.                                                                                       |
| **Attack scenario**    | Future refactor could regress role gates without CI failure.                                                                                                                                                                |
| **Reproduction steps** | N/A — preventive gap.                                                                                                                                                                                                       |
| **Impact**             | Reduced confidence in continuous verification of authorization invariants.                                                                                                                                                  |
| **Recommendation**     | Add tests: (1) member `updateMemberRole` on self → FORBIDDEN; (2) admin promotes self/member to `owner` → FORBIDDEN; (3) org owner/admin `addPlatformAdmin` → FORBIDDEN; (4) successful owner transfer after AUTHZ-001 fix. |
| **Retest result**      | —                                                                                                                                                                                                                           |

---

### AUTHZ-005 — Self-serve credit minting removed (closed)

| Field                  | Value                                                                                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | Critical (historical)                                                                                                                                                       |
| **Status**             | Closed                                                                                                                                                                      |
| **Affected component** | `aicoBilling.ts`, `organization.ts`                                                                                                                                         |
| **Description**        | Phase 1 audit identified unguarded `mockTopup` / `mockOrgTopup`. Both procedures are removed; credit flows require `platformAdmin.addManualCredit` / `addManualUserCredit`. |
| **Evidence**           | `aico.rbacIdor.test.ts` AICO-P1-001, AICO-P1-002 source assertions; non-platform callers receive FORBIDDEN on credit mutations.                                             |
| **Retest result**      | Pass (static + test reference)                                                                                                                                              |

---

### AUTHZ-006 — DB-enforced single active owner (closed)

| Field                  | Value                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | Informational                                                                                                                                                                     |
| **Status**             | Closed                                                                                                                                                                            |
| **Affected component** | `organization_members_unique_active_owner_idx`                                                                                                                                    |
| **Description**        | Partial unique index guarantees at most one `active` owner per org — defense-in-depth against dual-owner inconsistency even when application logic is incomplete (**AUTHZ-001**). |
| **Retest result**      | Pass (schema review)                                                                                                                                                              |

---

## 8. Privilege escalation summary

| Scenario (AICO-104)                           | Result                                     |
| --------------------------------------------- | ------------------------------------------ |
| Member → Admin (self)                         | ❌ Blocked — `requireOrgManager`           |
| Member → Owner (self)                         | ❌ Blocked — same                          |
| Admin → Owner (self or other)                 | ❌ Blocked — router owner-transfer gate    |
| Org Admin → Platform Admin                    | ❌ Blocked — no API without platform admin |
| Org Owner → Platform Admin (self)             | ❌ Blocked — same                          |
| Member → budget / model / credit change       | ❌ Blocked — manager/platform gates        |
| Org Admin → credit creation                   | ❌ Blocked — platform-only                 |
| Stranger → another org's resources            | ❌ Blocked — IDOR tests                    |
| Platform admin → org manager on arbitrary org | ✅ By design (AUTHZ-002)                   |

---

## 9. Definition of done (AICO-104)

| Criterion                      | Status                                                           |
| ------------------------------ | ---------------------------------------------------------------- |
| Permission matrix prepared     | ✅ §3                                                            |
| All roles tested               | ✅ Static matrix + existing IDOR tests                           |
| Privilege escalation tested    | ⚠️ Static pass; automated vertical tests missing (**AUTHZ-004**) |
| Mass assignment reviewed       | ✅ §5                                                            |
| Backend authorization reviewed | ✅ §4                                                            |
| Findings documented            | ✅ §7                                                            |

---

## 10. References

| Resource                    | Path                                                              |
| --------------------------- | ----------------------------------------------------------------- |
| Org router + guards         | `apps/server/src/routers/lambda/organization.ts`                  |
| Platform admin router       | `apps/server/src/routers/lambda/platformAdmin.ts`                 |
| Billing router              | `apps/server/src/routers/lambda/aicoBilling.ts`                   |
| Org model                   | `packages/database/src/models/organization.ts`                    |
| AICO schema                 | `packages/database/src/schemas/aicoOrganization.ts`               |
| RBAC regression tests       | `apps/server/src/routers/lambda/__tests__/aico.rbacIdor.test.ts`  |
| OSS RBAC stubs              | `packages/business-server/src/trpc-middlewares/rbacPermission.ts` |
| Phase 1 adversarial audit   | `AICO_PHASE1_AUDIT.md`                                            |
| Product lambda router mount | `apps/server/src/routers/lambda/index.ts:147-148`                 |

---

_Next retest file (if needed): `security-audit-reports/phase-01-identity-access/02-authorization-role-security-retest.md`_
