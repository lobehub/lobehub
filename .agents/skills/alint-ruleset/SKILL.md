---
name: alint-ruleset
description: "Maintain LobeHub's model-backed alint rule set in packages/alint: author a rule, calibrate its false positives against real source, decide its severity (warn vs error) from real PR data, and track its token cost. Use for adding or narrowing an alint rule, classifying findings as true/false positives, promoting or demoting a rule, or running the weekly rule-set review."
argument-hint: "add <rule> | calibrate <rule> | promote | weekly"
---

# alint rule set

`packages/alint` holds the model-backed lint rules for the judgement calls ESLint cannot
express — semantic rules such as "fan-out over a runtime-sized list needs `pMap`" or "a
secondary button is not `primary`". Each rule is a prompt that runs per file through
[alint](https://github.com/moeru-ai/alint) and is cached by file content.

This skill owns the **lifecycle** of that rule set: how a rule is written, how its false
positives are removed, when it earns `error`, and what it costs. It does **not** own the
rules themselves (they live in `packages/alint/rules`) and it does not restate the reading
contract — that is `packages/alint/README.md`. Read that file once before editing a rule.

## The loop

Everything below is one cycle. An ad-hoc task runs the phase it needs; the
[weekly review](references/weekly.md) runs the incremental phases on a schedule.

| Phase                          | What it does                                                                                       | Reference                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **A · Collect the standard**   | Pull the owner's recent review rejections, read them, keep the part that recurs and one file decides | [calibration.md](references/calibration.md#a--collect-the-standard) |
| **B · Author the rule**        | `rule.alint.toml`: what to report, where to anchor, and an explicit "do not report" list            | [rule-authoring.md](references/rule-authoring.md)              |
| **C · Calibrate**              | Scan → sample → classify TP/FP → write the recurring FP patterns back as carve-outs → cold-run fixtures | [calibration.md](references/calibration.md#c--calibrate)       |
| **D · Map the problems**       | Cluster findings across rules by file/area; that is the cleanup backlog                             | [calibration.md](references/calibration.md#d--map-the-problems) |
| **E · Promote**                | Read the rule's findings on real PRs; `warn → error` only at zero false positives                   | [promotion.md](references/promotion.md)                        |
| **F · Account for the cost**   | Token usage per run; cache invalidation is the cost driver                                          | [cost.md](references/cost.md)                                  |

## Decision rules

These are the calls that are easy to get wrong. They are not suggestions.

- **The owner's words are the standard.** A rule quotes the rejection it comes from,
  verbatim and in the original language; never paraphrase. If a comment is a requirement or
  a taste call that no single file can decide, it does not become a rule.
- **Deterministic checks belong in ESLint/stylelint, not alint.** If an AST or a path list
  decides it, ESLint decides it. alint is only for what neither can express —
  `no-node-in-browser` kept only the "does this npm package need Node at runtime" half and
  handed the import-path half to ESLint.
- **Carve-outs first.** Write the "do not report" list before the report list: the false
  positives live in the carve-outs. Every carve-out observed in calibration gets a `good-*`
  fixture, so the exemption stays true.
- **Scope with `[[config.group]] files`, never `includeFiles` inside a rule.** `includeFiles`
  only filters reports, so every file still runs (double the jobs) and the rule becomes
  uncacheable.
- **`error` is a promotion, not a starting point.** A new rule starts at `warn`, and is
  promoted only after its findings have been read on real PRs and measured at zero false
  positives. Fixture groups stay `warn` so a rule PR never fails on its own `bad-*` fixtures.
- **A rule that is mostly true but not worth acting on per PR does not belong in the PR
  check.** Too many findings, or weak precision, sends the rule to `alint.audit.toml`
  (`bun run alint:audit`). `test-the-exit-not-the-entry` was deleted for producing 92% of all
  findings and drowning the sharper rules.
- **Rule changes and product changes are different PRs.** A rule PR contains rules, config
  and fixtures only. A product fix that a rule surfaced gets its own PR **with acceptance**.
- **Sample precision is optimistic.** It is measured on the same sample the carve-outs were
  written from. Say so whenever the number is quoted.

## Preflight — before any calibration run

A calibration run fails expensively when the setup is not real. Check these in order; do not
interpret a skipped suite as a pass.

1. `.alint/config.toml` exists (gitignored; `bun run alint:setup`, needs `ALINT_API_KEY` or
   `DEEPSEEK_API_KEY`). Without it the fixture suite **skips rather than fails** — silence is
   not a pass.
2. `bun run alint plugin install` has run, and is re-run after adding a rule or a
   `packages/<pkg>/alint/rules` directory. A missing lock entry exits 2 with **no JSON**.
3. In a git worktree, install dependencies for real. A symlinked `node_modules` resolves
   `@lobechat/*` to the main checkout, so rule reads and type-checks lie.
4. **Delete `.alintcache` after every rule edit** while calibrating. The local cache is keyed
   by file content, so an edited rule otherwise replays the previous rule's findings.
5. Confirm a run is cold when a count is quoted. A warm run replays the previous results and
   costs nothing, which hides a regression.

## Where the pieces live

- **Rules** — `packages/alint/rules/<name>/rule.alint.toml` (repo-wide, plugin prefix
  `lobehub`). A rule about one package lives in `packages/<pkg>/alint/rules` under its own
  prefix (e.g. `hetero`) and is registered in the matching `[[config.group]]`.
- **Fixtures** — `packages/alint/fixtures/<name>/` (mirrored next to a package-level rule):
  `bad-*` with `// alint-expect` on the line above the anchor line (JSX children use
  `{/* alint-expect */}`), and one `good-*` per carve-out.
- **Scope** — root `alint.config.toml` (the PR check) and `alint.audit.toml` (the bulk
  audit). Everything a repo-wide group needs is `files`, `ignores`, `plugins`, `rules`.
- **Runner** — `bun run check --alint` (changed lines by default; explicit paths lint whole
  files), `bun run alint --dirty`, `bun run alint:audit`.
- **CI & reporting** — `.agents/scripts/check/alint.ts` (the `--alint` selector),
  `packages/alint/report.ts` (the ALint check run, its annotations, one PR summary comment
  with marker `<!-- alint-summary -->`, and a usage line), and the `ALint & Test Desktop App`
  job in `.github/workflows/test.yml`. The check is not required, so a red check informs
  rather than blocks.
- **Scripts in this skill** — [`scripts/`](scripts/): `collect-rejections.ts`,
  `sample-findings.ts`, `pull-alint-runs.ts`, `cost-report.ts`.

## Related skills — read them, do not restate them

`acceptance` (the rejection loop this rule set is fed by), `ux` (the design values the
`ui-*` rules encode), `react` / `compose-atoms` / `data-fetching-architecture` (the sources
of the engineering rules), `pr` (how a rule PR is opened and stacked on its base).
