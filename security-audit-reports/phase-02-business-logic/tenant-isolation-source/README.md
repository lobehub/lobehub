# Tenant Isolation — Prepared Source Kit

| Field                      | Value                                                                             |
| -------------------------- | --------------------------------------------------------------------------------- |
| **Archive (committed)**    | `../aico-tenant-isolation-source-bundle.tar.gz`                                   |
| **Extracted tree (local)** | this directory (gitignored except README)                                         |
| **Reports**                | `../03-tenant-isolation-security.md`, `../03-tenant-isolation-security-retest.md` |

## Extract / refresh locally

```bash
cd security-audit-reports/phase-02-business-logic
rm -rf tenant-isolation-source
mkdir -p tenant-isolation-source
tar -xzf aico-tenant-isolation-source-bundle.tar.gz -C tenant-isolation-source
```

Apply code changes in the **live repo** paths, not only inside the snapshot.

## Verify

```bash
bun run check --test apps/server/src/routers/lambda/__tests__/aico.rbacIdor.test.ts
```
