# Data, Secrets & Privacy Security Audit

| Field              | Value                                                                          |
| ------------------ | ------------------------------------------------------------------------------ |
| **Plane**          | [AICO-108](https://plane.panafor.com/panaforai/browse/AICO-108/)               |
| **Phase**          | Phase 3 — Application & Data Security                                          |
| **Finding prefix** | DATA-001 …                                                                     |
| **Audit date**     | 2026-08-10                                                                     |
| **Method**         | Static review + targeted regression tests                                      |
| **Scope**          | Sensitive data inventory, DB storage, logs, production errors, secret scanning |

---

## 1. Executive summary

Aico already hashed passwords, encrypted OpenRouter / API-key vault material, stripped invite tokens from member lists, and gated TRPC stacks behind `isDev`. This audit still found **real gaps**: plaintext phone/email OTPs in `verifications`, client-facing stack traces on SSE/stream errors, committed `KEY_VAULTS_SECRET` / `AUTH_SECRET` samples, raw OIDC/MCP/OpenRouter error bodies, and forever-revealable user API keys on list.

**Fixes in this delivery** close DATA-001…009 (P0/P1). DATA-010…014 are deferred / accepted with rationale below.

| Severity   | Open / Accepted | Fixed |
| ---------- | --------------: | ----: |
| High       |               0 |     5 |
| Medium     |               4 |     4 |
| Low / Info |               2 |     0 |

---

## 2. Sensitive data inventory

| Data                 | Where                                      | Protection (post-fix)                                          |
| -------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| Password             | `accounts.password`                        | scrypt (+ bcrypt verify for migrations) — Pass                 |
| Email OTP            | `verifications`                            | `storeOTP: "hashed"` — Fixed DATA-002                          |
| Phone OTP            | `verifications`                            | hashed via verification hook + `verifyOTP` — Fixed DATA-001    |
| Session token        | cookie / session table                     | HttpOnly + Secure (prod) — Pass (AUTH prior)                   |
| Phone / Email        | `users`                                    | PII; SMS logs redacted — Pass                                  |
| User API key         | `api_keys.key` ciphertext + `keyHash`      | Encrypted; list masked; plaintext create-only — Fixed DATA-009 |
| OpenRouter key       | `member_budgets` / user wallets ciphertext | Encrypted; not returned on wallet SPA — Pass                   |
| Wallet / usage / org | DB + security events                       | AuthZ + FIN audit trail — Pass (prior)                         |
| Admin activity       | `aico_security_audit_logs`                 | Metadata contract forbids secrets — Pass                       |

---

## 3. Findings

### DATA-001 — Phone OTP stored plaintext

| Field                  | Value                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Severity**           | High                                                                                                                             |
| **Status**             | Fixed                                                                                                                            |
| **Affected component** | Better Auth `phoneNumber` plugin / `verifications`                                                                               |
| **Description**        | Phone plugin wrote digit OTPs as `code:attempts` plaintext.                                                                      |
| **Fix**                | `verification.create` before-hook hashes digit OTPs; custom `verifyOTP` compares hashes with attempt limits (`phoneOtpHash.ts`). |
| **Retest**             | Pass — `phoneOtpHash.test.ts` + `auth.security.controls.test.ts`                                                                 |
| **Residual**           | Unused phone password-reset path still assumes plaintext if enabled without further work — Accepted until product enables it.    |

### DATA-002 — Email OTP stored plaintext

| Field        | Value                                                     |
| ------------ | --------------------------------------------------------- |
| **Severity** | High                                                      |
| **Status**   | Fixed                                                     |
| **Fix**      | `emailOTP({ storeOTP: 'hashed' })` in `define-config.ts`. |
| **Retest**   | Pass — security controls assert `storeOTP: 'hashed'`.     |

### DATA-003 — Agent SSE errors leak stacks

| Field        | Value                                                                                 |
| ------------ | ------------------------------------------------------------------------------------- |
| **Severity** | High                                                                                  |
| **Status**   | Fixed                                                                                 |
| **Fix**      | `createSSEWriter.writeError` includes `stack` only when `NODE_ENV === 'development'`. |
| **Retest**   | Pass — `sse.test.ts` production case.                                                 |

### DATA-004 — Hardcoded secrets in Grafana production compose

| Field        | Value                                                                            |
| ------------ | -------------------------------------------------------------------------------- |
| **Severity** | High                                                                             |
| **Status**   | Fixed                                                                            |
| **Fix**      | Compose uses `${KEY_VAULTS_SECRET}` / `${AUTH_SECRET}`.                          |
| **Note**     | Operators must rotate any environment that previously used the committed values. |

### DATA-005 — Tracked `.env.desktop` secret

| Field        | Value                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Severity** | High                                                                                                                                                              |
| **Status**   | Fixed                                                                                                                                                             |
| **Fix**      | Placeholder + generate instructions. Rotate vaults that used the old secret. Git history still contains the old value — treat as compromised for that sample key. |

### DATA-006 — `.env.example.development` concrete secrets

| Field        | Value              |
| ------------ | ------------------ |
| **Severity** | Medium             |
| **Status**   | Fixed              |
| **Fix**      | Placeholders only. |

### DATA-007 — OIDC route echoes `error.message`

| Field        | Value                                                                 |
| ------------ | --------------------------------------------------------------------- |
| **Severity** | Medium                                                                |
| **Status**   | Fixed                                                                 |
| **Fix**      | Client gets `Internal Server Error`; details stay in `console.error`. |

### DATA-008 — Model stream FIRST\_CHUNK\_ERROR includes stack

| Field        | Value                                                                     |
| ------------ | ------------------------------------------------------------------------- |
| **Severity** | Medium                                                                    |
| **Status**   | Fixed                                                                     |
| **Fix**      | `buildStreamErrorPayload` omits `stack` when `NODE_ENV === 'production'`. |

### DATA-009 — API keys forever revealable via list

| Field        | Value                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Severity** | Medium                                                                                                                 |
| **Status**   | Fixed                                                                                                                  |
| **Fix**      | `ApiKeyModel.create` returns plaintext once; `query` returns masked placeholder only; create modal shows copy-once UI. |
| **Retest**   | Pass — `apiKey.test.ts` + UI tests.                                                                                    |

### DATA-010 — Invite tokens plaintext at rest

| Field         | Value                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------- |
| **Severity**  | Medium                                                                                      |
| **Status**    | Accepted Risk (deferred)                                                                    |
| **Rationale** | List strips tokens; short TTL. Hash-at-rest needs invite-link redesign. Track as follow-up. |

### DATA-011 — Connector `clientSecret` plaintext JSONB

| Field         | Value                                                             |
| ------------- | ----------------------------------------------------------------- |
| **Severity**  | Medium                                                            |
| **Status**    | Accepted Risk (deferred)                                          |
| **Rationale** | Access tokens encrypted; clientSecret schema migration is larger. |

### DATA-012 — OAuth access/refresh tokens plaintext in `accounts`

| Field         | Value                                                           |
| ------------- | --------------------------------------------------------------- |
| **Severity**  | Medium                                                          |
| **Status**    | Accepted Risk                                                   |
| **Rationale** | Better Auth default; encrypting breaks BA without adapter work. |

### DATA-013 — OpenRouter management errors embed response body

| Field        | Value                                                |
| ------------ | ---------------------------------------------------- |
| **Severity** | Medium                                               |
| **Status**   | Fixed                                                |
| **Fix**      | Throw statusText only; log body preview server-side. |

### DATA-014 — Docs sample KEY\_VAULTS / AUTH secrets

| Field        | Value                     |
| ------------ | ------------------------- |
| **Severity** | Low                       |
| **Status**   | Fixed (docs placeholders) |

### DATA-015 — MCP init errors return raw `error.message`

| Field        | Value                                             |
| ------------ | ------------------------------------------------- |
| **Severity** | Low                                               |
| **Status**   | Fixed                                             |
| **Fix**      | Generic TRPC message; details logged server-side. |

### DATA-016 — Example DB URLs with passwords

| Field         | Value                       |
| ------------- | --------------------------- |
| **Severity**  | Info                        |
| **Status**    | Accepted                    |
| **Rationale** | Local/CI placeholders only. |

---

## 4. Definition of Done checklist

| Criterion                 | Status                                                                   |
| ------------------------- | ------------------------------------------------------------------------ |
| Sensitive data identified | ✅ Inventory section                                                     |
| Database review           | ✅ Passwords / OTP / keys                                                |
| Log review                | ✅ OTP not in stdout; SMS redacted (prior); OR body not in Error.message |
| Error handling review     | ✅ OIDC / SSE / stream / MCP                                             |
| Secret scan               | ✅ Compose / .env.desktop / examples / docs scrubbed                     |
| Git history               | ⚠️ Old sample secrets remain in history — rotate operational keys        |

---

## 5. Key files

| Path                                                                                   | Role                    |
| -------------------------------------------------------------------------------------- | ----------------------- |
| `src/libs/better-auth/define-config.ts`                                                | OTP hashing config      |
| `src/libs/better-auth/phoneOtpHash.ts`                                                 | Phone OTP hash helpers  |
| `packages/utils/src/server/sse.ts`                                                     | SSE stack gating        |
| `packages/model-runtime/src/core/streams/protocol.ts`                                  | Stream error payload    |
| `packages/database/src/models/apiKey.ts`                                               | Show-once / masked list |
| `security-audit-reports/phase-03-application-data/07-data-secrets-privacy-security.md` | This report             |

---

_Retest file (if needed): `07-data-secrets-privacy-security-retest.md`_
