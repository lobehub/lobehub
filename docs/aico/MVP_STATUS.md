# Aico MVP — Current Status

> **Last updated:** 2026-08-06\
> **Branch:** `feat/auth-signin-openrouter-ui` (`bba4d38026`)\
> **Strategy:** Build the financial engine first; test with **manual credit only** (no real payment gateway). Connect **Zarinpal** only after internal pilot approval.

This document maps the MVP roadmap (Phases 1, 5, 6, pilot gate, and post-pilot Zarinpal) to what exists in the codebase today.

---

## Executive summary

| Phase               | Theme                               | Overall status                                                                       |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| **Phase 1**         | Authentication & authorization      | **Mostly complete** — helpers, session contract, SSO, phone policy implemented       |
| **Phase 5**         | Organization wallet (manual credit) | **Complete for MVP** — balance, ledger, admin top-up, transaction history API + UI   |
| **Phase 6**         | Usage dashboard                     | **Complete for MVP** — date-range org/member usage charts + Org Admin UI             |
| **Pilot gate**      | Internal MVP approval               | **Not started** (process) — release-gate tests exist; formal pilot checklist pending |
| **Phase 5 (cont.)** | Zarinpal integration                | **Not started**                                                                      |

---

## Recent shipping activity

| Item                             | Link                                                                                                                    | Notes                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Auth UI redesign PR              | [#100](https://github.com/Panafor-Ai-Team/Aico/pull/100)                                                                | OpenRouter-style sign-in, icon-only SSO row, monochrome Google icon |
| Auth UI issue                    | [#99](https://github.com/Panafor-Ai-Team/Aico/issues/99)                                                                |                                                                     |
| Plane tracker                    | [AICO-58](https://plane.panafor.com/panaforai/browse/AICO-58/)                                                          | Testing                                                             |
| OAuth env example fix (separate) | [#83](https://github.com/Panafor-Ai-Team/Aico/pull/83) / [AICO-52](https://plane.panafor.com/panaforai/browse/AICO-52/) | `AUTH_GITHUB_*` naming in `.env.example`                            |

---

## Phase 1 — Authentication & Authorization

**Story:** Unified Better Auth experience + “VIP access passes” so every layer knows the caller’s role.

### Helper functions (access passes)

| Function                           | Spec                                  | Status   | Implementation                                                                                                |
| ---------------------------------- | ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------- |
| `getCurrentOrgRole(userId, orgId)` | `owner` / `admin` / `member` / `null` | **Done** | `apps/server/src/services/auth/orgRole.ts` → `OrganizationModel.getMemberRole()`                              |
| `isPlatformAdmin(userId)`          | `true` / `false`                      | **Done** | `apps/server/src/services/auth/orgRole.ts` → `platformAdmins` table via `OrganizationModel.isPlatformAdmin()` |

**Tests:** `apps/server/src/services/auth/orgRole.test.ts`, `packages/database/src/models/__tests__/organization.test.ts`

**Dead code note:** `apps/server/src/services/orgAccess/index.ts` is an unused stub (always `null` / `false`). Safe to delete; real helpers live in `services/auth/orgRole.ts`.

### Session user shape (shared contract)

**Status: Done**

```ts
// src/libs/better-auth/session-user.ts — AicoSessionUser
session.user = {
  id,
  name,
  email,
  emailVerified,
  phoneNumber,
  phoneNumberVerified,
  image,
};
```

Mapped via `toAicoSessionUser()` and consumed by `UserUpdater`, billing guards, and profile UI.

### Auth methods

| Method           | Status                      | Notes                                                                                 |
| ---------------- | --------------------------- | ------------------------------------------------------------------------------------- |
| Email / password | **Done**                    | Better Auth in `src/libs/better-auth/define-config.ts`                                |
| GitHub OAuth     | **Done**                    | SSO providers via `AUTH_SSO_PROVIDERS`; callback `{APP_URL}/api/auth/callback/github` |
| Google OAuth     | **Done (config-dependent)** | Requires `AUTH_SSO_PROVIDERS=github,google` + matching Google Console redirect URIs   |
| Phone OTP        | **Done**                    | Sign-in / sign-up / verify flows under `src/features/Auth/`                           |
| Account linking  | **Done**                    | `accountLinking.enabled: true`, `trustedProviders` from env                           |

**Recent UI work:** OpenRouter-style auth card, icon-only SSO row (`src/features/Auth/AuthSocialButtons.tsx`), labeled fields, “Last used” badge removed.

### Phone verification policy

**Status: Done** (for spend/trial activation — **not** a login gate)

| Caller                     | Policy                     | Implementation                                |
| -------------------------- | -------------------------- | --------------------------------------------- |
| Already verified           | Skip                       | `requiresPhoneVerification()` returns `false` |
| Org `member` (invited)     | Skip                       | Does not block login or invited-member access |
| Org `owner` / `admin`      | Require before spend/trial | Enforced in billing + org creation paths      |
| Independent buyer (no org) | Require before trial       | `aicoBilling` trial activation                |

Key files:

- `apps/server/src/services/auth/orgRole.ts` — `requiresPhoneVerification()`
- `apps/server/src/routers/lambda/organization.ts` — `requireVerifiedPhone()` for org admin actions
- `apps/server/src/routers/lambda/aicoBilling.ts` — phone check on trial

### Phase 1 success checklist

| Check                                              | Status          | Evidence / gap                                                                                                         |
| -------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Email/password works                               | **Done**        | Better Auth + sign-in/sign-up UI                                                                                       |
| GitHub auth works                                  | **Done**        | SSO wired; env docs in `.env.example.aico`                                                                             |
| No duplicate accounts (email + GitHub same person) | **Mostly done** | Account linking + conflict error codes (`ACCOUNT_ALREADY_LINKED_TO_DIFFERENT_USER`, etc.) — **needs pilot validation** |
| Org admins must verify phone                       | **Done**        | `requiresPhoneVerification` + `requireVerifiedPhone`                                                                   |
| Invited members not blocked by phone               | **Done**        | `role === 'member'` skips verification requirement                                                                     |

---

## Phase 5 — Organization Wallet (internal financial engine)

**Story:** Organization vault; balance topped up only via Admin Panel (Arash) during MVP — no real money movement.

### Spec procedures vs codebase

| Spec procedure                             | Status             | Current equivalent                                                                                     |
| ------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------ |
| `getWalletBalance(orgId)` → `balanceToman` | **Done** (renamed) | `organization.getOrgWallet` — returns `balanceToman`, `balanceUsd`, `balanceMicroUsd` as **strings**   |
| `getTransactionHistory(orgId, from, to)`   | **Done**           | `organization.getTransactionHistory` — inclusive UTC `YYYY-MM-DD` range; Org Admin wallet statement UI |
| Admin manual top-up                        | **Done**           | `platformAdmin.addManualCredit` (platform admin only)                                                  |
| Dev/mock org top-up                        | **Done** (gated)   | `organization.mockOrgTopup` — blocked in production; requires `AICO_ALLOW_MOCK_TOPUP`                  |

### Data layer

| Asset              | Path                                                | Notes                                                                 |
| ------------------ | --------------------------------------------------- | --------------------------------------------------------------------- |
| Org wallet columns | `packages/database/src/schemas/aicoOrganization.ts` | `walletBalanceToman`, `walletBalanceMicroUsd` on `organizations`      |
| Transaction ledger | `walletTransactions` table                          | Written by `OrganizationModel.addManualCredit`, renewals, allocations |
| Manual credit      | `OrganizationModel.addManualCredit()`               | Atomic balance + ledger insert                                        |
| Personal wallet    | `userWallets` + `AicoBillingModel`                  | Separate B2C path; `aicoBilling.getMyWallet`                          |

### API surface (tRPC)

| Procedure               | Router          | RBAC                                              |
| ----------------------- | --------------- | ------------------------------------------------- |
| `getOrgWallet`          | `organization`  | Org manager (`owner` / `admin`) or platform admin |
| `getTransactionHistory` | `organization`  | Org manager — inclusive UTC date range            |
| `getOrgUsageChart`      | `organization`  | Org manager — daily usage buckets                 |
| `getMemberUsageChart`   | `organization`  | Org manager — member-scoped daily buckets         |
| `mockOrgTopup`          | `organization`  | Org manager + mock gate                           |
| `addManualCredit`       | `platformAdmin` | Platform admin only                               |
| `addManualUserCredit`   | `platformAdmin` | Platform admin — personal wallet                  |
| `getMyWallet`           | `aicoBilling`   | Authenticated user                                |
| `getMyTransactions`     | `aicoBilling`   | Personal transactions only (limit, no date range) |

### UI

| Surface         | Path                                                | Features                                                |
| --------------- | --------------------------------------------------- | ------------------------------------------------------- |
| Platform Admin  | `src/features/PlatformAdmin/PlatformAdminPanel.tsx` | Org list, manual credit, user wallets, trial config     |
| Org Admin       | `src/features/OrgAdmin/OrgAdminMembers.tsx`         | Wallet tab, mock top-up (when enabled), balance display |
| Personal wallet | `src/features/AicoWallet/index.tsx`                 | Balance, mock top-up, trial, transaction list           |

### Mock top-up safety

`apps/server/src/services/aico/mockTopupGate.ts`:

- **Production:** always `MOCK_TOPUP_DISABLED` (no env override)
- **Non-production:** requires `AICO_ALLOW_MOCK_TOPUP=1` or `true`

### Phase 5 success checklist

| Check                                       | Status   |
| ------------------------------------------- | -------- |
| Balance reads return string money values    | **Done** |
| All balance mutations on server             | **Done** |
| Manual credit via Arash panel               | **Done** |
| Transaction ledger persisted                | **Done** |
| Org transaction history API (`from` / `to`) | **Done** |
| Org transaction history UI                  | **Done** |

---

## Phase 6 — Usage Dashboard (transparency layer)

**Story:** Customers see how money is used — usage charts for members and organizations.

### Spec procedures vs codebase

| Spec procedure                               | Status   | Current equivalent                                                                       |
| -------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `getMemberUsageChart(orgMemberId, from, to)` | **Done** | `organization.getMemberUsageChart` — daily UTC buckets from `usage_logs`                 |
| `getOrgUsageChart(orgId, from, to)`          | **Done** | `organization.getOrgUsageChart` — daily UTC buckets; Org Admin overview date-range chart |

### What exists today

| Capability              | Status   | Location                                                        |
| ----------------------- | -------- | --------------------------------------------------------------- |
| OpenRouter usage sync   | **Done** | `AicoOpenRouterKeyService.syncMemberUsage()`                    |
| Usage logging           | **Done** | `usageLogs` table; `AicoBillingModel.recordUsage()`             |
| Org dashboard snapshot  | **Done** | `OrganizationModel.getOrgDashboardStats()`                      |
| Date-range usage charts | **Done** | `getOrgUsageChart` / `getMemberUsageChart` + Org Admin overview |
| Personal usage list     | **Done** | `aicoBilling` — `listUserUsage` (limit only)                    |

### Phase 6 success checklist

| Check                                   | Status                                         |
| --------------------------------------- | ---------------------------------------------- |
| Org manager sees member spend           | **Done** (table + snapshot bars + dated chart) |
| Date-range usage charts                 | **Done**                                       |
| Dedicated chart APIs with `from` / `to` | **Done**                                       |

---

## Internal MVP Pilot (approval gate)

**Story:** Full team tests complete workflow. **No Zarinpal** until pilot is approved.

### Automated release gates

| Test suite            | Path                                                                       | Purpose                                                            |
| --------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| RBAC / IDOR           | `apps/server/src/routers/lambda/__tests__/aico.rbacIdor.test.ts`           | Member/stranger cannot access org wallet, platform admin mutations |
| Phase 3 release gate  | `apps/server/src/services/aico/aico.phase3.releaseGate.test.ts`            | Env fail-closed, journey tests, static secret probes               |
| Financial concurrency | `packages/database/src/models/__tests__/aico.financialConcurrency.test.ts` | No negative balances under concurrent debits                       |
| Phase 3 E2E journeys  | `packages/database/src/models/__tests__/aico.phase3.e2eJourneys.test.ts`   | End-to-end billing journeys                                        |
| Chat bypass guard     | `apps/server/src/services/aico/aico.chatBypassProduction.test.ts`          | Chat must record/sync usage                                        |
| Invitation lifecycle  | `packages/database/src/models/__tests__/aico.invitationLifecycle.test.ts`  | Invite accept/expire flows                                         |
| Trial abuse           | `packages/database/src/models/__tests__/aico.trialAbuse.test.ts`           | Trial phone blocking                                               |

### Manual pilot checklist (recommended)

- [ ] Sign up with email → sign in with GitHub (same email) — no duplicate user
- [ ] Platform admin creates org + manual credit (toman)
- [ ] Org admin invites member — member joins **without** phone verification block
- [ ] Org admin actions require verified phone
- [ ] Allocate member budget; chat consumes quota; `BUDGET_EXCEEDED` when exhausted
- [ ] Org wallet empty → `ORG_WALLET_EMPTY` on allocation/renewal
- [ ] Org dashboard shows member usage after OpenRouter sync
- [ ] Mock top-up disabled in production build
- [ ] Personal wallet trial (non-production, when enabled)

**Pilot status:** Process not formally signed off; automated gates passing in CI.

---

## Phase 5 (continued) — Zarinpal payment gateway

**Story:** Connect tested financial engine to Zarinpal after pilot approval.

| Spec procedure                                     | Status          | Notes                                                                                                                                              |
| -------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initiateTopup(orgId, amountToman)` → `paymentUrl` | **Not started** | No tRPC procedure or route handler                                                                                                                 |
| Bank callback route handler                        | **Not started** | Spec: standard Next.js Route Handler (banks don’t speak tRPC)                                                                                      |
| Zarinpal credentials in env                        | **Not started** | Upstream LobeHub has subscription Zarinpal **locale strings only** (`packages/locales/src/default/subscription.ts`) — not wired to Aico org wallet |

**Blocked by:** Internal MVP pilot approval.

---

## Team golden rules (vault standards)

| Rule                                               | Status      | Evidence                                                            |
| -------------------------------------------------- | ----------- | ------------------------------------------------------------------- |
| Financial calculations on server only              | **Done**    | `OrganizationModel`, `AicoBillingModel`, `renewalScheduler`         |
| Monetary values as strings over network            | **Done**    | `tomanString()`, `microUsdToDecimalString()` in tRPC responses      |
| Two-key approval (Arash reviews financial changes) | **Process** | Platform-admin-only mutations; no automated second approver in code |
| Sensitive secrets never logged                     | **Guarded** | Release-gate static analysis in `aico.phase3.releaseGate.test.ts`   |

---

## Shared contracts

### Standard errors

| Code                | Status   | Location                                                                    |
| ------------------- | -------- | --------------------------------------------------------------------------- |
| `BUDGET_EXCEEDED`   | **Done** | `packages/business/const/src/aicoErrors.ts`                                 |
| `ORG_WALLET_EMPTY`  | **Done** | Alias from `INSUFFICIENT_ORG_BALANCE`                                       |
| Localized copy (FA) | **Done** | `AICO_ERROR_MESSAGES_FA` + `src/business/client/resolveAicoErrorMessage.ts` |
| i18n (en)           | **Done** | `packages/locales/src/default/aico.ts`                                      |

### User session shape

**Done** — see [Session user shape](#session-user-shape-shared-contract) above.

---

## Gap summary (work remaining pre-Zarinpal)

| Priority       | Gap                                       | Suggested deliverable                                                 |
| -------------- | ----------------------------------------- | --------------------------------------------------------------------- |
| **P2**         | Delete `services/orgAccess/index.ts` stub | Avoid confusion with real `orgRole.ts` helpers                        |
| **P3**         | Phase 1 pilot sign-off                    | Manual checklist above                                                |
| **Post-pilot** | Zarinpal `initiateTopup` + callback route | Route handler → verify payment → `addManualCredit`-style ledger entry |

---

## Recommended build order

```
Phase 1 pilot verify
    ↓
Internal MVP pilot (manual credit + usage charts + wallet statement)
    ↓
[Approval gate]
    ↓
Zarinpal initiateTopup + callback route handler
```

---

## Key file index

### Authentication

- `src/libs/better-auth/define-config.ts` — Better Auth config, SSO, account linking
- `src/libs/better-auth/session-user.ts` — Session contract
- `apps/server/src/services/auth/orgRole.ts` — RBAC + phone policy helpers
- `src/features/Auth/` — Sign-in, sign-up, verify phone, social buttons

### Wallet & billing

- `packages/database/src/schemas/aicoOrganization.ts` — Org, wallet, transaction schemas
- `packages/database/src/models/organization.ts` — Org wallet, manual credit, dashboard stats
- `packages/database/src/models/aicoBilling.ts` — Personal wallet, usage logs
- `apps/server/src/routers/lambda/organization.ts` — Org wallet, dashboard, mock top-up
- `apps/server/src/routers/lambda/platformAdmin.ts` — Platform admin, manual credit
- `apps/server/src/routers/lambda/aicoBilling.ts` — Personal wallet, trial, transactions

### Usage & keys

- `apps/server/src/services/openrouter/keyService.ts` — Managed keys, usage sync
- `apps/server/src/services/aico/chatGuard.ts` — Pre-chat billing guard
- `apps/server/src/services/aico/renewalScheduler.ts` — Budget renewal/settlement

### UI

- `src/features/PlatformAdmin/PlatformAdminPanel.tsx`
- `src/features/OrgAdmin/OrgAdminMembers.tsx`
- `src/features/AicoWallet/index.tsx`

### Errors & i18n

- `packages/business/const/src/aicoErrors.ts`
- `packages/locales/src/default/aico.ts`
- `src/business/client/resolveAicoErrorMessage.ts`

### Related docs

- `docs/aico/PERIODIC_BUDGET_ARCHITECTURE.md`
- `docs/aico/RENEWAL_SETTLEMENT_RUNBOOK.md`
- `docs/aico/TRIAL_ATOMIC_QUOTA_FOLLOWUP.md`

---

## Local dev notes (not committed)

For OAuth locally:

```env
APP_URL=http://localhost:3210
AUTH_SSO_PROVIDERS=github,google
AUTH_GITHUB_ID=...
AUTH_GITHUB_SECRET=...
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...
```

Google Console must include localhost origins and redirect URI `{APP_URL}/api/auth/callback/google`.

For mock top-up in dev:

```env
AICO_ALLOW_MOCK_TOPUP=1
```

Restart the app after env changes.
