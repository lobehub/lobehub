# Tenant Isolation Audit — Source Access

## Full repository

| Item                                  | Value                                         |
| ------------------------------------- | --------------------------------------------- |
| Local workspace                       | `/home/mhdyr/Develop/torobche`                |
| Remote                                | `https://github.com/Panafor-Ai-Team/Aico.git` |
| Branch (local)                        | `canary`                                      |
| Commit with isolation fixes + reports | `015c25f567`                                  |

```bash
git clone https://github.com/Panafor-Ai-Team/Aico.git
cd Aico
# If the commit is only local / not yet pushed:
# git fetch <remote> && git checkout 015c25f567
```

> Note: As of 2026-08-08 the fix commit may still be **local-only** (branch was behind `origin/canary` and had diverged after commit). Push or share the branch before remote auditors can pull it.

## Focused source bundle (this audit surface)

Portable archive of the tenant-isolation code paths + reports:

`security-audit-reports/phase-02-business-logic/aico-tenant-isolation-source-bundle.tar.gz` (\~78KB)

### Extracted & prepared in-repo (preferred)

```text
security-audit-reports/phase-02-business-logic/tenant-isolation-source/
```

Open `tenant-isolation-source/README.md` first. Paths inside mirror the live repo.

```bash
# Re-extract from archive if needed:
rm -rf security-audit-reports/phase-02-business-logic/tenant-isolation-source
mkdir -p security-audit-reports/phase-02-business-logic/tenant-isolation-source
tar -xzf security-audit-reports/phase-02-business-logic/aico-tenant-isolation-source-bundle.tar.gz \
  -C security-audit-reports/phase-02-business-logic/tenant-isolation-source
```

Or from archive only:

```bash
tar -xzf security-audit-reports/phase-02-business-logic/aico-tenant-isolation-source-bundle.tar.gz
```

### Included paths

- **tRPC:** `organization.ts`, `aicoBilling.ts`, `platformAdmin.ts`
- **IDOR tests:** `aico.rbacIdor.test.ts`
- **Policy / keys:** `managedPolicy.ts`, `billingContext.ts`, `keyService.ts`, `chatGuard.ts`
- **DB:** `packages/database/src/models/organization.ts`, `aicoBilling.ts`, `schemas/aicoOrganization.ts`
- **Chat HTTP:** `src/app/(backend)/webapi/chat/[provider]/route.ts`
- **Reports:** `03-tenant-isolation-security.md`, `03-tenant-isolation-security-retest.md`

## Suggested audit entry points

1. Read `03-tenant-isolation-security.md` (findings TENANT-001 … TENANT-009).
2. Read `03-tenant-isolation-security-retest.md` for fix verification status.
3. Trace manager gates in `apps/server/src/routers/lambda/organization.ts` (`requireOrgManager`, `requireMemberInOrg`).
4. Trace chat spend auth in `apps/server/src/services/aico/managedPolicy.ts`.
5. Run: `bun run check --test apps/server/src/routers/lambda/__tests__/aico.rbacIdor.test.ts`

## Required test matrix (manual)

Create **Organization A** and **Organization B**, each with Owner / Admin / Member. Swap:

`organizationId`, `userId`, `memberId` / `orgMemberId`, `invitationId`, and related IDs across tenants; expect `FORBIDDEN` / `NOT_FOUND` with no cross-tenant data.
