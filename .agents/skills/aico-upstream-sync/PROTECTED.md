# Aico protected surfaces

Use this inventory during upstream sync impact analysis. Paths are relative to repo root.
Treat **globs** as high-care: prefer keeping Aico behavior unless the user approves otherwise.

## Product pillars (do not silently regress)

1. **Branding** — product name / logos / provider id from env (`BRANDING_*`, `NEXT_PUBLIC_BRANDING_*`); defaults are **Aico**, not LobeHub.
2. **Managed provider** — UI shows Aico (or `BRANDING_NAME`); runtime uses allocated OpenRouter keys (`aico` ↔ `openrouter` mapping).
3. **Charging / wallets** — B2C + org billing, FX (toman), periodic budgets, trial gates, chat guard.
4. **Key lifecycle** — OpenRouter Management API: create / update / delete / decrypt keys per user/wallet.
5. **B2B / admin** — Platform admin + Org admin panels (credit, members, invites, policy).
6. **Auth / locale** — phone auth, fa-IR, RTL (`applyDocumentDirection`), Persian auth SPA.
7. **Deploy / self-host** — Aico Docker/moz packaging, deploy overrides, persistence checks.

## Critical paths (default: keep Aico)

### Billing & OpenRouter

- `apps/server/src/services/aico/**`
- `apps/server/src/services/openrouter/**`
- `apps/server/src/routers/lambda/aicoBilling.ts`
- `apps/server/src/routers/lambda/platformAdmin.ts`
- `apps/server/src/routers/lambda/__tests__/aico*.ts`
- `src/features/AicoBilling/**`
- `src/features/AicoWallet/**`
- `src/app/(backend)/api/aico/**`
- `packages/env/src/aico.ts`
- `docs/aico/**`

### Branding & managed provider UI

- `packages/business/const/src/branding.ts`
- `packages/business/const/src/branding.test.ts`
- `packages/business/const/src/aicoErrors.ts`
- `packages/business/const/src/index.ts` (business feature + `BRANDING_PROVIDER` helpers)
- `packages/business-server/src/aiProvider.ts` (and related Aico access hooks)
- `apps/server/src/services/aiProviderAccess.ts`
- `apps/server/src/services/aico/managedPolicy.ts`
- `src/routes/(main)/settings/provider/**` (esp. `AicoManagedRedirect`, managed status SWR)
- `src/store/chat/agents/transports/ClientLLMTransport.ts` (`BRANDING_PROVIDER` no-retry)
- `apps/desktop/stubs/business-const/**`

### Admin / B2B panels

- `src/features/PlatformAdmin/**`
- `src/features/OrgAdmin/**`
- Routes/nav that hide or gate platform admin (URL-only entry, RBAC/IDOR tests)

### Auth, i18n, RTL

- Auth phone / verify-phone flows under `src/routes/auth/**`, `src/spa/**` auth entries as patched by Aico
- `locales/fa-IR/**`
- `locales/*/aico.json`
- `src/utils/client/applyDocumentDirection.ts`
- `src/utils/client/switchLang.ts` / dayjs locale mapping for region locales
- `src/layout/GlobalProvider/AppTheme.tsx` (direction / RTL)

### Database

- Aico-owned migrations (historically `0131+` / tags containing `aico`) under `packages/database/migrations/`
- `packages/database/migrations/meta/_journal.json`
- `packages/database/src/core/migrations.json`
- Schema/repos touching wallets, OpenRouter key columns, trial/budget tables

When upstream adds a migration with the **same numeric prefix**, keep Aico’s files and renumber upstream — never delete Aico SQL to “match” lobehub numbering.

### Deploy / ops

- `docker-compose/deploy/**` Aico overrides (`.env.example.aico`, `docker-compose.aico.override.yml`, moz packaging)
- `.env.example.aico`
- DB persistence check scripts added for Aico ship

### Process overlays (Aico-owned skills)

- `.agents/skills/aico-ship/**`
- `.agents/skills/aico-upstream-sync/**`
- Cursor rules for Plane/GitHub language

Do not replace these with upstream `pr` / `linear` behavior.

## Soft-protected (merge carefully)

Upstream changes here are common; re-apply Aico hooks after taking structural upstream edits:

| Area                                    | Why careful                                                         |
| --------------------------------------- | ------------------------------------------------------------------- |
| Provider settings / model list UI       | Free-model filters, modalities, managed redirect                    |
| Quota / usage / credits (upstream)      | May collide with Aico wallet charging                               |
| Better Auth / session user contract     | Aico session.user wiring                                            |
| Home shell / InputArea moves            | Past sync conflicts were heavy                                      |
| Desktop titlebar / tabs                 | Often conflict; usually take upstream chrome, keep branding strings |
| `AGENTS.md` / skills from upstream      | Keep Aico overlays; don’t drop `aico-ship` pointers                 |
| `eslint.config.mjs` / router boundaries | Take upstream structure; re-add Aico exceptions if any              |

## Detection helpers

Fork-touched files since last common ancestor:

```bash
git log --name-only --pretty=format: upstream/canary..origin/canary | sort -u
```

Aico markers in a file (ours side during merge):

```bash
git show ":2:$file" | rg -i 'aico|AicoManaged|isManagedAico|BRANDING_|OPENROUTER_MANAGEMENT|fa-IR|applyDocumentDirection|PlatformAdmin|AicoBilling'
```

Env / branding invariants:

| Variable / symbol               | Role                                     |
| ------------------------------- | ---------------------------------------- |
| `BRANDING_NAME`                 | UI + metadata name (default `Aico`)      |
| `BRANDING_PROVIDER`             | Managed provider id (default `official`) |
| `ORG_NAME` / cloud name         | Legal / cloud labeling                   |
| `OPENROUTER_MANAGEMENT_API_KEY` | Server-only key minting                  |
| `AICO_OPENROUTER_MOCK`          | Non-prod mock only                       |
| `AICO_TOMAN_PER_USD`            | FX fallback                              |
| `AICO_ALLOW_TRIAL`              | Trial gate (non-prod)                    |

## After resolving a protected file

Confirm still true:

1. Managed chat still goes through Aico key allocation (not a shared global OpenRouter user key).
2. Platform admin can still credit / manage within RBAC tests.
3. Branding strings remain Aico (or env override), not hard-coded LobeHub on primary surfaces.
4. fa-IR auth and RTL direction still apply.
5. Migrations journal is a single linear sequence including both Aico and renumbered upstream entries.
