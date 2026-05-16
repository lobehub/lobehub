---
name: review-checklist
description: 'Common recurring mistakes in LobeHub code review — console leftovers, missing return await, hardcoded secrets, hardcoded i18n strings, desktop router pair drift, antd vs @lobehub/ui, non-idempotent migrations, cloud impact red flags. Use as a quick checklist when reviewing PRs, diffs, or branch changes.'
user-invocable: false
---

# Review Checklist

## Correctness

- Leftover `console.log` / `console.debug` — should use `debug` package or remove
- Missing `return await` in try/catch — see <https://typescript-eslint.io/rules/return-await/> (not in our ESLint config yet, requires type info)
- Can the fix/implementation be more concise, efficient, or have better compatibility?

## Security

- No sensitive data (API keys, tokens, credentials) in `console.*` or `debug()` output
- No base64 output to terminal — extremely long, freezes output
- No hardcoded secrets — use environment variables

## Testing

- Bug fixes must include tests covering the fixed scenario
- New logic (services, store actions, utilities) should have test coverage
- Existing tests still cover the changed behavior?
- Prefer `vi.spyOn` over `vi.mock` (see `/testing` skill)

## i18n

- New user-facing strings use i18n keys, not hardcoded text
- Keys added to `src/locales/default/{namespace}.ts` with `{feature}.{context}.{action|status}` naming
- For PRs: `locales/` translations for all languages updated (`pnpm i18n`)

## SPA / routing

- **`desktopRouter` pair:** If the diff touches `src/spa/router/desktopRouter.config.tsx`, does it also update `src/spa/router/desktopRouter.config.desktop.tsx` with the same route paths and nesting? Single-file edits often cause drift and blank screens.

## Reuse

- Newly written code duplicates existing utilities in `packages/utils` or shared modules?
- Copy-pasted blocks with slight variation — extract into shared function
- `antd` imports replaceable with `@lobehub/ui` wrapped components (`Input`, `Button`, `Modal`, `Avatar`, etc.)
- Use `antd-style` token system, not hardcoded colors; prefer `createStaticStyles` + `cssVar.*` over `createStyles` + `token` unless runtime computation is required

## Database

- Migration scripts must be idempotent (`IF NOT EXISTS`, `IF EXISTS` guards)

## Cloud Impact

A downstream cloud deployment depends on this repo. Flag changes that may require cloud-side updates:

- **Backend route paths changed** — e.g., renaming `src/app/(backend)/webapi/chat/route.ts` or changing its exports
- **SSR page paths changed** — e.g., moving/renaming files under `src/app/[variants]/(auth)/`
- **Dependency versions bumped** — e.g., upgrading `next` or `drizzle-orm` in `package.json`
- **`@lobechat/business-*` exports changed** — e.g., renaming a function in `src/business/` or changing type signatures in `packages/business/`
- `src/business/` and `packages/business/` must not expose cloud commercial logic in comments or code
