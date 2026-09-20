# LobeHub alint rules

Model-backed lint rules for the judgement calls eslint cannot express. Each rule is a prompt plus a structured-output schema, run per file by [alint](https://github.com/moeru-ai/alint) and cached by file content, so a repeated run over unchanged files costs nothing.

This is Phase 0: rules live in this repo as declarative `rule.alint.toml` files. Rules that prove generic move to `@lobehub/lint` as a published plugin later; repo-specific rules stay here.

## Rules

| Rule                          | Scope                                  | Source of the rule                              |
| ----------------------------- | -------------------------------------- | ----------------------------------------------- |
| `pmap-over-promise-all`       | `apps/server/src`, `packages/database` | fan-out over a runtime-sized list needs `pMap`  |
| `no-dynamic-import-in-server` | same                                   | backend code uses static top-level imports      |
| `no-effect-fetching`          | `src/**/*.tsx`                         | `data-fetching-architecture` skill              |
| `no-mode-flags`               | `src/**/*.tsx`                         | `compose-atoms` skill                           |
| `test-the-exit-not-the-entry` | Vitest files                           | tests assert outcomes, not only that a mock ran |

Scopes are declared as `[[config.group]]` entries in the root `alint.config.toml`. Never scope a rule with `includeFiles` inside `rule.alint.toml`: it only filters reports, so every file still runs (double the jobs), and it marks the rule uncacheable.

## Setup and run

```bash
export ALINT_API_KEY=...     # or DEEPSEEK_API_KEY
bun run alint:setup          # writes .alint/config.toml (gitignored)
bun run alint plugin install # registers ./.agents/alint/rules (once, and after adding a rule)

bun run check --alint          # changed files, alongside the other selectors
bun run alint --dirty          # the same scope, alint's own reporter
bun run alint src/features/Foo # any files or directories
```

Defaults are DeepSeek `deepseek-flash` at `https://api.deepseek.com/v1`; override with `ALINT_PROVIDER_ENDPOINT` and `ALINT_MODEL`. Any OpenAI-compatible endpoint with tool calling works. `thinking` is disabled on the model because alint forces a tool call for structured output and DeepSeek V4 rejects that while reasoning is on.

Findings are warnings. Treat them like a reviewer's comment: fix, or explain in the PR why the rule's carve-out applies.

## CI

The `alint ·` steps at the end of the Test Desktop App job in `.github/workflows/test.yml` run on every push and pull request, on the change's diff only, and never fail the check (they reuse that job's root install instead of paying for a runner of their own):

- `alint --dirty` lints the working tree against `HEAD` and keeps only findings on changed lines. The steps fetch the merge base (against the PR base, or `canary` on a push) and run `git reset --mixed <merge-base>`, which turns the whole change into dirty changes, so the scope is exactly its diff and nothing older is reported. On a push to `canary` itself the diff is empty and nothing runs.
- Findings become inline warning annotations (`.agents/alint/annotate.ts`) plus a table in the job summary.
- The provider key comes from the `DEEPSEEK_API_KEY` repository secret. Fork PRs cannot read it, so the steps are skipped.
- When `alint.config.toml` or anything under `.agents/alint` changed, the fixture suite runs too, so a rule edit is calibrated before it lands.
- `.alintcache` is restored from the last run with the same rule set, keyed by the rule and config files.

## Cost and behaviour, measured 2026-09-20

| Run                                   | Jobs | Wall | Tokens     |
| ------------------------------------- | ---- | ---- | ---------- |
| 80 files (20.8k lines), 2 rules, cold | 80   | 23 s | 290k input |
| same, warm cache                      | 0    | 2 s  | 0          |
| one file changed                      | 1    | 3 s  | 873        |

About 14 input tokens per source line per rule. Two cold runs over the same files differed by one finding; a finding can appear or vanish between runs, which is why fixtures exist and why the severity stays at `warn`.

## Adding a rule

1. Create `rules/<name>/rule.alint.toml` with `name`, `builtInAgent = "basic-structured"`, and an `instruction`. Write the rule as the reviewer would: what to report, which line to anchor on, what the message and suggestion must contain, and an explicit "do not report" list. The carve-outs are where the false positives live.
2. Add a `[[config.group]]` for its scope in `alint.config.toml`, and a fixture group `.agents/alint/fixtures/<name>/**`.
3. Add fixtures under `fixtures/<name>/`: at least one `bad-*` file with a standalone `// alint-expect` comment on the line above the one the finding must anchor to, and one `good-*` file per carve-out. Keep them short and realistic.
4. Run `bun run alint plugin install`, then `cd .agents/alint && bunx vitest run fixtures.test.ts` with a provider set up. The suite skips itself when there is no setup.
5. Before enabling the rule on a scope, run it over a few dozen real files and read every finding.
