---
name: code-review
description: 'Code review checklist for LobeHub. Use when reviewing PRs, diffs, or code changes. Covers style, correctness, security, performance, and project-specific patterns.'
---

# Code Review Guide

## Phase 0: Load Context

1. Read code style skills before reviewing:
   - `/typescript` — type safety, imports, async patterns
   - `/testing` — test conventions, mock patterns
2. Read the diff: `git diff` or `git diff origin/canary..HEAD`
3. Identify which areas are touched (frontend, backend, database, i18n, etc.)

## Phase 1: Correctness

### Low-Level Errors

- Leftover `console.log` / `console.debug` (debug-only, should use `debug` package or remove)
- Commented-out code blocks that serve no purpose
- Unused imports, variables, or parameters
- Hardcoded values that should be constants or config
- Missing `await` on async calls
- Wrong error handling: empty `catch {}`, swallowed errors without logging

### Logic Errors

- Off-by-one errors in loops/slices
- Incorrect condition logic (missing negation, wrong operator precedence)
- Race conditions in async flows (missing `Promise.all`, unguarded shared state)
- State updates that don't account for stale closures in React

### Type Safety

- `as any` / `@ts-ignore` without justification
- Implicit `any` from untyped function parameters
- Non-null assertions (`!`) on values that could genuinely be null
- Type narrowing gaps (missing null checks before access)

## Phase 2: Security

- **Sensitive data in logs**: API keys, tokens, user credentials, session data must never appear in `console.*` or `debug()` output
- **LobeHub Cloud secrets**: never expose internal business logic, pricing, or infrastructure details
- **SQL injection**: verify parameterized queries in raw SQL; Drizzle ORM is safe by default but check `sql.raw()` / `sql\`\`\` usage
- **XSS**: user-generated content rendered with `dangerouslySetInnerHTML` or similar must be sanitized
- **SSRF**: server-side URL fetching must validate/allowlist target hosts
- **Auth bypass**: API routes must check auth/permissions; verify middleware is applied
- **Secrets in code**: no hardcoded API keys, tokens, or passwords; use environment variables

## Phase 3: Code Quality

### Architecture

- Does the change follow existing patterns in the codebase? (Service → Store → Component)
- Are new files in the correct directory? (`src/features/` for business logic, `src/routes/` for thin page segments)
- Does it break existing abstractions or introduce unnecessary new ones?
- Are Zustand store slices properly separated by concern?

### Reuse and Duplication

- Does newly written code duplicate existing utilities in `packages/utils` or shared modules?
- Copy-pasted code blocks with slight variation — should be extracted into a shared function
- Inline logic that existing npm dependencies or project helpers already handle

### Testing

- Are there missing tests for new logic? (especially for services, store actions, utility functions)
- Do existing tests still cover the changed behavior?
- Are mocks appropriate? (prefer `vi.spyOn` over `vi.mock`; see `/testing` skill)

### i18n

- New user-facing strings must use i18n keys, not hardcoded text
- Keys added to `src/locales/default/{namespace}.ts`? (see `/i18n` skill)
- Key naming follows `{feature}.{context}.{action|status}` flat convention

### Database

- Migration scripts must be idempotent (use `IF NOT EXISTS`, `IF EXISTS` guards)
- Schema changes should not break backward compatibility without migration plan
- Query performance: avoid N+1 patterns, select only needed columns

## Phase 4: Performance

- Unnecessary re-renders: missing `useMemo`/`useCallback` on expensive computations or callbacks passed as props
- Large bundle impact: new dependencies should be justified; prefer tree-shakeable imports
- Redundant API calls: same data fetched multiple times without SWR caching
- Hot-path bloat: heavy computation in render path or request handlers
- Missing cleanup: event listeners, timers, subscriptions not cleaned up in `useEffect` return

## Phase 5: Style and Conventions

- Import order follows `simple-import-sort` rules; type imports use `import type { ... }` (separate statement)
- Use `@lobehub/ui` / Ant Design components, not raw HTML
- Use `antd-style` token system, not hardcoded colors
- JSDoc for complex logic; English comments unless file already uses Chinese extensively
- Gitmoji in commit messages

## Output Format

- Number all findings sequentially
- Indicate priority: `[high]` / `[medium]` / `[low]`
- Include file path and line number for each finding
- Only list problems — no summary of what was done well, no praise
- After reviewing diffs, re-read full source for each finding to verify it's real (not a false positive from missing context), then output "以上问题我已核实"
