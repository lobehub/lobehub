# Phase 01 — Authentication & Session Security

| Field                 | Value                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------- |
| **Audit area**        | Authentication, Session Management, OTP, OAuth, Verification                            |
| **Phase**             | Phase 1 — Identity & Access Security                                                    |
| **Finding ID prefix** | `AUTH-xxx`                                                                              |
| **Report path**       | `security-audit-reports/phase-01-identity-access/01-authentication-session-security.md` |
| **Plane**             | [AICO-102](https://plane.panafor.com/panaforai/browse/AICO-102)                         |
| **Date**              | 2026-08-08                                                                              |
| **Method**            | Static review + practical Vitest attack/control suites (defensive; no exploit payloads) |
| **Retest**            | AUTH-001…005 closed in this pass (AUTH-004 Accepted Risk); MON-001/005 Fixed            |

---

## Executive summary

Aico authentication is built on **Better Auth** (`src/libs/better-auth/define-config.ts`) with Aico overlays: Iranian phone OTP (Kavenegar), `phoneLoginGate`, org/trial phone gates, and redirect sanitization.

**Core controls (Pass):** scrypt password hashing (bcrypt verify for Clerk migrations), 6-digit OTP / 300s TTL / 3 attempts / single-use, production rate limits on sign-in / OTP / password reset, HttpOnly + Secure (HTTPS) + SameSite=Lax cookies, `revokeSessionsOnPasswordReset: true`, OAuth trusted-origin + `sanitizeRedirectPath`, phone gates for org create / convertToManagement / trial.

**This pass closed auth findings:**

| ID           | Fix                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AUTH-001** | `/api/auth/check-user` no longer returns `hasPassword`; IP sliding-window rate limit (10/60s); sign-in always uses password step for existing users |
| **AUTH-002** | Server `getSession` calls use `query: { disableCookieCache: true }` on TRPC, chat middleware, proxy, utils auth, trusted-client, messenger install  |
| **AUTH-003** | `minPasswordLength: 8` + server `passwordPolicy` (letter + digit) on sign-up / change / reset                                                       |
| **AUTH-005** | `forceChangePasswordRevoke` plugin always sets `revokeOtherSessions: true` on `/change-password`                                                    |
| **MON-001**  | Debug SMS no longer `console.info`s OTPs; `AUTH_SMS_DEBUG_OTP` ignored in production                                                                |
| **MON-005**  | OTP send failure logs redact phone to last 4 digits                                                                                                 |

**Remaining:** AUTH-004 (Medium, Accepted Risk — email verification off by default). MON-002/003 still Open (auth abuse alerting; owned by monitoring phase).

**Verdict:** No open Critical/High in auth/session scope. Mediums either Fixed or Accepted Risk. Suitable for pilot from an auth-control perspective pending product acceptance of AUTH-004 and monitoring gaps (MON-002/003).

---

## Security checks matrix

| #   | Check                                  | Result                  | Evidence                                                                                               |
| --- | -------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Password policy                        | Pass                    | `minPasswordLength: 8` + letter/digit server policy — AUTH-003 Fixed                                   |
| 2   | Password hashing                       | Pass                    | Better Auth scrypt + bcrypt verify for `$2a$`/`$2b$`                                                   |
| 3   | OTP expiration                         | Pass                    | `OTP_EXPIRES_IN = 300` — `auth.security.controls.test.ts`                                              |
| 4   | OTP invalidate after use               | Pass                    | Better Auth phone/email OTP delete-on-success                                                          |
| 5   | OTP replay                             | Pass                    | Single-use + `allowedAttempts: 3`                                                                      |
| 6   | OTP rate limit                         | Pass                    | send-otp 3/60s; verify 10/60s — config test                                                            |
| 7   | Login rate limit                       | Pass                    | Better Auth `/sign-in*` special rule (3/10s) in production                                             |
| 8   | Password reset rate limit              | Pass                    | `/request-password-reset` 3/60s                                                                        |
| 9   | Brute-force protection                 | Pass (partial residual) | Login + OTP + check-user rate limits; no CAPTCHA/account lockout                                       |
| 10  | User enumeration                       | Pass (mitigated)        | `hasPassword` removed; check-user rate-limited — AUTH-001 Fixed (`exists` alone remains for signup UX) |
| 11  | Session token unpredictability         | Pass                    | Better Auth CSPRNG session tokens                                                                      |
| 12  | Session fixation                       | Pass                    | Fresh session on sign-in; logout deletes server session                                                |
| 13  | Session hijacking mitigations          | Pass                    | Cookie flags + AUTH-002 Fixed (no cookie-cache auth window on APIs)                                    |
| 14  | Logout invalidates session             | Pass                    | DB delete + `disableCookieCache` on sensitive `getSession`                                             |
| 15  | Password change invalidates sessions   | Pass                    | Reset revokes all; `/change-password` forced revoke — AUTH-005 Fixed                                   |
| 16  | Cookies HttpOnly / Secure / SameSite   | Pass                    | Better Auth defaults                                                                                   |
| 17  | OAuth redirect abuse                   | Pass                    | `trustedOrigins` + `sanitizeRedirectPath` tests                                                        |
| 18  | Account linking takeover               | Pass (caveats)          | BA local email verify for link; `allowDifferentEmails: true` for logged-in link                        |
| 19  | Phone verification bypass              | Pass                    | `requireVerifiedPhone` + `phone-login-gate` + RBAC tests                                               |
| 20  | Email verification / API before verify | Accepted Risk           | Default `AUTH_EMAIL_VERIFICATION=false` — AUTH-004                                                     |

---

## Required attack tests (practical)

| Attack test                           | Result                        | How tested                                                                                                    |
| ------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Password brute-force                  | Pass                          | Config asserts login / reset rate limits (`auth.security.controls.test.ts`)                                   |
| OTP brute-force                       | Pass                          | `allowedAttempts: 3` + verify rate limits asserted                                                            |
| OTP replay                            | Pass                          | Single-use OTP design in BA plugins (config + BA behavior)                                                    |
| Password Reset replay                 | Pass                          | Token consume + `revokeSessionsOnPasswordReset: true` asserted                                                |
| Session reuse after logout            | Pass                          | AUTH-002 Fixed — `disableCookieCache` on TRPC/chat/proxy (`context.test.ts`, `middleware/auth/index.test.ts`) |
| Session reuse after password change   | Pass                          | Reset revokes sessions + cookie cache bypass on APIs                                                          |
| OAuth callback manipulation           | Pass                          | Trusted origins / origin checks (static + BA)                                                                 |
| Open Redirect in OAuth                | Pass                          | `onboardingRedirect.test.ts` (17 cases) + controls test                                                       |
| Phone Verification bypass             | Pass                          | `phone-login-gate.test.ts` (6) + org `PHONE_VERIFICATION_REQUIRED` in `aico.rbacIdor.test.ts`                 |
| Email Verification bypass             | Accepted Risk                 | Default config off — AUTH-004 documented                                                                      |
| Direct API access before verification | Partial / Pass for Aico spend | Org create / convert / trial blocked without phone; chat allowed with session by design                       |

**Suite run (this pass):** `check-user` route + rateLimit, `auth.security.controls`, `phone-login-gate`, `onboardingRedirect`, `useSignIn`, TRPC context, auth middleware — **72+ related tests passed** (full related `bun run check` slice: **121 passed**).

---

## Findings

### AUTH-001 — Unauthenticated email existence / auth-method oracle

- **Finding ID:** AUTH-001

- **Title:** `/api/auth/check-user` disclosed account existence and password capability

- **Severity:** Medium

- **Status:** Fixed

- **Affected Component:** `src/app/(backend)/api/auth/check-user/route.ts`; `rateLimit.ts`; `src/features/Auth/SignIn/useSignIn.ts`

- **Description:**\
  Public POST previously returned `{ exists, hasPassword }` with no rate limit, enabling email + auth-method enumeration.

- **Attack Scenario:**\
  Bulk-check emails to prioritize credential stuffing and learn password vs OAuth-only accounts.

- **Reproduction Steps (pre-fix):**
  1. `POST /api/auth/check-user` with an email.
  2. Observe `hasPassword` in JSON; no 429 under rapid fire.

- **Impact:**\
  Facilitates phishing and credential stuffing prioritization.

- **Recommendation / Fix:**\
  Dropped `hasPassword`; IP sliding-window rate limit (10/min); sign-in always opens password step for existing users (no magic-link auto-branch from oracle). Residual: `exists` still returned for signup redirect UX (throttled).

- **Retest Result:** Pass — `route.test.ts`, `rateLimit.test.ts`, `useSignIn.test.ts`

---

### AUTH-002 — Session cookie cache survives DB session revocation

- **Finding ID:** AUTH-002

- **Title:** `session.cookieCache` authorized APIs without DB session check

- **Severity:** Medium

- **Status:** Fixed

- **Affected Component:** TRPC lambda context; chat `middleware/auth`; Next proxy; `packages/utils` getUserAuth; trusted-client; messenger install

- **Description:**\
  Cookie cache (`maxAge: 2 min`) could authorize requests after logout / password-reset DB revoke when `getSession` did not pass `disableCookieCache`.

- **Attack Scenario:**\
  Stolen cookies remain valid on TRPC/chat for up to \~2 minutes after victim resets password or signs out elsewhere.

- **Reproduction Steps (pre-fix):**
  1. Note `cookieCache.enabled` in `define-config.ts`.
  2. Confirm server `getSession` lacked `disableCookieCache`.

- **Impact:**\
  Undermined revoke-on-reset and cross-device logout on high-value APIs.

- **Recommendation / Fix:**\
  All sensitive server `getSession` calls now pass `query: { disableCookieCache: true }`.

- **Retest Result:** Pass — `packages/trpc/src/lambda/context.test.ts`, `middleware/auth/index.test.ts`

---

### AUTH-003 — Password policy is length-only

- **Finding ID:** AUTH-003

- **Title:** No complexity or breached-password checks beyond 8–64 characters

- **Severity:** Low

- **Status:** Fixed

- **Affected Component:** `define-config.ts`; `plugins/password-policy.ts`; signup/reset forms

- **Description:** Length-only policy; weak passwords accepted server-side.

- **Attack Scenario:** Guessing / stuffing against weak passwords (mitigated by login rate limit).

- **Reproduction Steps:** Confirm only `minPasswordLength` / `maxPasswordLength` in Better Auth config.

- **Impact:** Higher success rate for slow/distributed password guessing.

- **Recommendation / Fix:** Kept `minPasswordLength` at 8 (UX); added `passwordPolicy` plugin requiring letter + digit on sign-up / change-password / reset-password; UI validators aligned to shared `PASSWORD_MIN_LENGTH`.

- **Retest Result:** Pass — `password-policy.test.ts`, `auth.security.controls.test.ts`

---

### AUTH-004 — Email verification not required for authenticated APIs (Aico default)

- **Finding ID:** AUTH-004

- **Title:** Default Aico config leaves email-unverified users with full session/API access

- **Severity:** Medium

- **Status:** Accepted Risk

- **Affected Component:** `packages/env/src/auth.ts`; `authedProcedure` / chat auth

- **Description:**\
  `AUTH_EMAIL_VERIFICATION` defaults false. Phone verification is the spend/org trust anchor.

- **Attack Scenario:** Register with victim’s email (unverified) and use non-phone-gated APIs until phone gates apply.

- **Reproduction Steps:** Confirm default env + no `emailVerified` check on `authedProcedure`.

- **Impact:** Email is not a strong identity control; org/trial/spend paths still require phone.

- **Recommendation:** Keep Accepted Risk with product sign-off; or enable `AUTH_EMAIL_VERIFICATION=1` in production.

- **Retest Result:** N/A (Accepted Risk)

---

### AUTH-005 — `/change-password` does not revoke other sessions by default

- **Finding ID:** AUTH-005

- **Title:** Better Auth `changePassword` leaves other sessions unless `revokeOtherSessions: true`

- **Severity:** Low

- **Status:** Fixed

- **Affected Component:** `plugins/force-change-password-revoke.ts`; Better Auth change-password API

- **Description:** Reset path revokes sessions. Direct change-password was opt-in for revoke.

- **Attack Scenario:** Custom client calls `changePassword` without revoke flag; other device sessions remain.

- **Reproduction Steps:** Confirm UI uses reset; BA `revokeOtherSessions` optional on change-password.

- **Impact:** Latent footgun; low exploitability via stock UI.

- **Recommendation / Fix:** `forceChangePasswordRevoke` before-hook always injects `revokeOtherSessions: true`.

- **Retest Result:** Pass — `force-change-password-revoke.test.ts`

---

## Positive controls

| Control                                | Notes                                         |
| -------------------------------------- | --------------------------------------------- |
| OTP TTL + attempts + single-use        | emailOTP + phoneNumber plugins                |
| Phone login gate                       | Blocks OTP login for never-verified numbers   |
| Org/trial phone enforcement            | `PHONE_VERIFICATION_REQUIRED`                 |
| Password reset anti-enumeration        | Better Auth reset path                        |
| Cookie flags                           | HttpOnly, Lax, Secure on HTTPS                |
| OAuth / open-redirect hardening        | `sanitizeRedirectPath` / `isSafeRedirectPath` |
| SMS production fail-closed             | No Debug SMS without Kavenegar in production  |
| OTP not on stdout                      | MON-001 Fixed                                 |
| Phone PII redaction on SMS fail        | MON-005 Fixed                                 |
| Session revoke on password reset       | `revokeSessionsOnPasswordReset: true`         |
| Cookie cache bypass on APIs            | AUTH-002 Fixed                                |
| check-user rate limit + no hasPassword | AUTH-001 Fixed                                |

---

## Related findings

| ID                | Overlap                         | Status |
| ----------------- | ------------------------------- | ------ |
| MON-001           | OTP plaintext in logs           | Fixed  |
| MON-005           | Phone PII in OTP failure logs   | Fixed  |
| MON-002 / MON-003 | No alerting for login/OTP abuse | Open   |

---

## Finding rollup

| Severity | Count | IDs                                                    |
| -------- | ----- | ------------------------------------------------------ |
| Critical | 0     | —                                                      |
| High     | 0     | —                                                      |
| Medium   | 3     | AUTH-001 Fixed; AUTH-002 Fixed; AUTH-004 Accepted Risk |
| Low      | 2     | AUTH-003 Fixed; AUTH-005 Fixed                         |

| Status        | Findings                                                 |
| ------------- | -------------------------------------------------------- |
| Fixed         | AUTH-001, AUTH-002, AUTH-003, AUTH-005, MON-001, MON-005 |
| Accepted Risk | AUTH-004                                                 |
| Open          | — (auth scope); MON-002/003 monitoring                   |

---

## Definition of Done checklist

| Item                                     | Done?                                 |
| ---------------------------------------- | ------------------------------------- |
| All Authentication Flows reviewed/tested | Yes                                   |
| Session Management reviewed              | Yes (+ AUTH-002 Fixed)                |
| OAuth reviewed                           | Yes                                   |
| Verification bypass tested               | Yes (phone Pass; email Accepted Risk) |
| Brute-force scenarios tested             | Yes (config + rate-limit tests)       |
| All Findings documented (`AUTH-xxx`)     | Yes                                   |
| Report at required path                  | Yes                                   |

---

## References

- `src/libs/better-auth/define-config.ts`
- `src/app/(backend)/api/auth/check-user/route.ts`
- `src/app/(backend)/api/auth/check-user/rateLimit.ts`
- `packages/trpc/src/lambda/context.ts`
- `src/app/(backend)/middleware/auth/index.ts`
- `apps/server/src/routers/lambda/organization.ts`
- `src/utils/onboardingRedirect.ts`
- Tests: `auth.security.controls.test.ts`, `check-user/*.test.ts`, `phone-login-gate.test.ts`, `onboardingRedirect.test.ts`
- Plane: <https://plane.panafor.com/panaforai/browse/AICO-102>
