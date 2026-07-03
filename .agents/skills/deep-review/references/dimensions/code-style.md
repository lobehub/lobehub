---
id_prefix: style
verify: true
skip_when: docs/lockfile-only diff
---

# Code Style

Fragment-level readability and convention adherence. Look at each changed hunk in isolation — cross-file reuse and abstraction questions belong to `reuse-architecture`.

## Quick checklist

- Leftover `console.log` / `console.debug` — use the `debug` package or remove
- Missing `return await` inside try/catch (the rejection escapes the catch) — <https://typescript-eslint.io/rules/return-await/>
- Hardcoded user-facing strings — must go through i18n keys (`src/locales/default/<namespace>.ts`, named `{feature}.{context}.{action|status}`)
- `antd` imports where `@lobehub/ui` (or `@lobehub/ui/base-ui`) wraps the same component — base-ui first, then `@lobehub/ui`, antd last
- Hardcoded colors / raw CSS values — use `antd-style` tokens; prefer `createStaticStyles` + `cssVar.*` over `createStyles` + `token` unless styles need runtime computation
- Dead code, commented-out blocks, unused exports introduced by this diff
- Comments: missing on hacky/non-obvious logic; stale after a signature change; or merely restating the code
- Nesting ≥ 3 levels that early returns / lookup tables would flatten
- Redundant or derivable state: a variable/state field that mirrors a prop or is computable from existing state — derive it (selector, `useMemo`, plain expression) instead of storing a second copy that can drift
- Type looseness: `any`, runtime narrowing that the type signature hides, implicit contracts
- File ballooning past \~800 lines without splitting

## Rule sources (deep mode: read before reviewing)

- `.agents/skills/typescript/SKILL.md` — TS style and type-safety rules
- `.agents/skills/react/SKILL.md` — component conventions, base-ui/@lobehub/ui/antd priority, styling
- `.agents/skills/i18n/SKILL.md` — locale key conventions, what needs a key
- Repo root `AGENTS.md` / `CLAUDE.md` — repo-wide conventions

## How to check

1. Read the diff hunk by hunk; style issues must be visible within the fragment (plus its file).
2. For UI imports: `rg "from 'antd'" <changed files>` and check whether `@lobehub/ui` or `@lobehub/ui/base-ui` exports the same component.
3. For strings: scan added JSX/text literals; anything a user can see needs an i18n key.
4. For comments: diff the signature/behavior changes against surrounding JSDoc — flag stale docs.

## Violations

- Anything in the Quick checklist, when introduced or made worse by this diff.
- Naming that misleads (name says X, code does Y) — this is a violation even when the codebase has other weak names, because it is newly introduced.

## Not violations

- Formatting that Prettier/ESLint already enforces — CI owns it, do not report.
- Naming that is merely bland but accurate.
- Pre-existing style debt in untouched lines (calibration principle: this diff didn't make it worse).
- Comment density matching the file's existing norm — do not demand JSDoc on every function in a file that comments sparsely.
