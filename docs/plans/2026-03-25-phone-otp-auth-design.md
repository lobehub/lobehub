# Phone OTP Authentication Design

## Goal

Add phone number sign-in/sign-up using Jiguang SMS and Better Auth `phone-number` plugin.

## Scope

- Add phone OTP send + verify login flow
- Auto-register user on first verified phone login
- Use Jiguang SMS for OTP delivery
- Support China mainland phone numbers only in MVP (`+86`)
- Reuse existing Better Auth session/cookie flow

## Chosen Approach

Use Better Auth `phone-number` plugin instead of custom OTP/session logic.

## Why

- Reuses existing auth/session infrastructure
- Avoids duplicating OTP storage and cookie/session creation
- Matches current auth architecture
- Supports verify-and-sign-in and sign-up-on-verification out of the box

## Backend Design

### Env

Add SMS env vars under auth env parsing:

- `SMS_APP_KEY`
- `SMS_MASTER_SECRET`
- `SMS_TEMPLATE_ID`
- `SMS_SIGN_ID`
- `SMS_CODE_TTL`
- `SMS_AUTO_REGISTER_ON_PHONE_LOGIN`
- `SMS_PHONE_RESEND_INTERVAL`

### Better Auth

Enable `phone-number` plugin in `src/libs/better-auth/define-config.ts`.

Plugin behavior:

- validate mainland China phone numbers
- send OTP through Jiguang
- verify OTP via Better Auth verification store
- auto-create user on first verification when enabled
- create session cookie after verification

### User Data

Map Better Auth phone fields to existing user schema:

- `phoneNumber -> phone`
- `phoneNumberVerified -> phoneNumberVerified`

For auto-created users, generate:

- temp email: `phone-<normalized>@phone.local`
- temp display name: normalized phone number

## Frontend Design

Add a phone login entry to existing sign-in page.

Two-step flow:

1. Enter phone number and send OTP
2. Enter OTP and complete login

MVP behavior:

- only `+86`
- 6-digit OTP
- 300s validity
- 60s resend cooldown
- success redirects to `callbackUrl`

## Validation

- Add focused auth env tests if suitable
- Add focused Jiguang SMS service tests
- Add focused sign-in hook/component tests for phone flow
- Run targeted vitest files only

## Non-goals

- phone password sign-in
- phone reset password
- phone re-binding in profile
- non-China regions
- captcha/risk engine

## Notes

Do not commit secrets. `SMS_MASTER_SECRET` must remain in environment variables only.
