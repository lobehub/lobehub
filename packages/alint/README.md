# LobeHub alint rules

Model-backed lint rules for the judgement calls eslint cannot express. Each rule is a prompt plus a structured-output schema, run per file by [alint](https://github.com/moeru-ai/alint) and cached by file content, so a repeated run over unchanged files costs nothing.

This is Phase 0: the rule set is a private workspace package (`@lobechat/alint`) of declarative `rule.alint.toml` files. Rules that prove generic move to `@lobehub/lint` as a published plugin later; repo-specific rules stay here.

## Rules

| Rule                          | Severity | Scope                                  | Source of the rule                              |
| ----------------------------- | -------- | -------------------------------------- | ----------------------------------------------- |
| `pmap-over-promise-all`       | error    | `apps/server/src`, `packages/database` | fan-out over a runtime-sized list needs `pMap`  |
| `no-transactions-in-models`   | error    | `packages/database/src/models`         | cross-table write transactions use repositories |
| `no-effect-fetching`          | error    | `src/**/*.tsx`                         | `data-fetching-architecture` skill              |
| `no-dynamic-import-in-server` | warn     | `apps/server/src`, `packages/database` | backend code uses static top-level imports      |
| `no-mode-flags`               | warn     | `src/**/*.tsx`                         | `compose-atoms` skill                           |

`error` is reserved for rules measured at zero false positives on real PRs; an error turns the ALint check red. A rule starts at `warn` and is promoted only after its findings have been read on real PRs. A rule whose findings are mostly true but not worth acting on per PR does not belong here: `test-the-exit-not-the-entry` was removed after five days because it produced 92% of all findings and drowned out the rest.

Scopes are declared as `[[config.group]]` entries in the root `alint.config.toml`. Never scope a rule with `includeFiles` inside `rule.alint.toml`: it only filters reports, so every file still runs (double the jobs), and it marks the rule uncacheable.

## Setup and run

```bash
export ALINT_API_KEY=...     # or DEEPSEEK_API_KEY
bun run alint:setup          # writes .alint/config.toml (gitignored)
bun run alint plugin install # registers ./packages/alint/rules (once, and after adding a rule)

bun run check --alint          # changed files, alongside the other selectors
bun run alint --dirty          # the same scope, alint's own reporter
bun run alint src/features/Foo # any files or directories
```

Defaults are DeepSeek `deepseek-flash` at `https://api.deepseek.com/v1`; override with `ALINT_PROVIDER_ENDPOINT` and `ALINT_MODEL`. Any OpenAI-compatible endpoint with tool calling works. `thinking` is disabled on the model because alint forces a tool call for structured output and DeepSeek V4 rejects that while reasoning is on.

Treat findings like a reviewer's comment: fix them, or explain in the PR why the rule's carve-out applies. Locally, `bun run check --alint` fails on `error` findings like any other lint error.

## CI

The `alint ·` steps at the end of the "ALint & Test Desktop App" job in `.github/workflows/test.yml` run on every push and pull request, on the change's diff only (they reuse that job's root install instead of paying for a runner of their own). The desktop job itself never fails because of alint:

- `alint --dirty` lints the working tree against `HEAD` and keeps only findings on changed lines. The steps fetch the merge base (against the PR base, or `canary` on a push) and run `git reset --mixed <merge-base>`, which turns the whole change into dirty changes, so the scope is exactly its diff and nothing older is reported. On a push to `canary` itself the diff is empty and nothing runs.
- `packages/alint/report.ts` publishes the result as a separate **ALint** check run on the head commit: red when any `error` finding exists, neutral with only warnings, green when clean. Findings are attached to it as line annotations. The check is not a required status, so it does not block merging, but a red check reaches whoever watches CI, including agents woken by CI failures.
- The same table goes into one summary comment on the open PR for the branch, rewritten in place on every push. It is created only once there is something to report; when a later push is clean the comment flips to a green verdict instead of disappearing.
- Findings on the calibration fixtures are dropped from the check and the comment; the fixture suite covers them.
- The provider key comes from the `DEEPSEEK_API_KEY` repository secret. Fork PRs cannot read it, so the steps are skipped.
- When `alint.config.toml` or anything under `packages/alint` changed, the fixture suite runs too, so a rule edit is calibrated before it lands.
- `.alintcache` is restored from the last run with the same rule set, keyed by the rule and config files.

## Cost and behaviour, measured 2026-09-20

| Run                                   | Jobs | Wall | Tokens     |
| ------------------------------------- | ---- | ---- | ---------- |
| 80 files (20.8k lines), 2 rules, cold | 80   | 23 s | 290k input |
| same, warm cache                      | 0    | 2 s  | 0          |
| one file changed                      | 1    | 3 s  | 873        |

About 14 input tokens per source line per rule. Two cold runs over the same files differed by one finding; a finding can appear or vanish between runs, which is why fixtures exist and why only rules measured at zero false positives are promoted to `error`.

## Adding a rule

1. Create `rules/<name>/rule.alint.toml` with `name`, `builtInAgent = "basic-structured"`, and an `instruction`. Write the rule as the reviewer would: what to report, which line to anchor on, what the message and suggestion must contain, and an explicit "do not report" list. The carve-outs are where the false positives live.
2. Add a `[[config.group]]` for its scope in `alint.config.toml`, and a fixture group `packages/alint/fixtures/<name>/**`.
3. Add fixtures under `fixtures/<name>/`: at least one `bad-*` file with a standalone `// alint-expect` comment on the line above the one the finding must anchor to, and one `good-*` file per carve-out. Keep them short and realistic.
4. Run `bun run alint plugin install`, then `cd packages/alint && bunx vitest run fixtures.test.ts` with a provider set up. The suite skips itself when there is no setup.
5. Before enabling the rule on a scope, run it over a few dozen real files and read every finding.
