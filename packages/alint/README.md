# LobeHub alint rules

Model-backed lint rules for the judgement calls eslint cannot express. Each rule is a prompt plus a structured-output schema, run per file by [alint](https://github.com/moeru-ai/alint) and cached by file content, so a repeated run over unchanged files costs nothing.

This is Phase 0: the rule set is a private workspace package (`@lobechat/alint`) of declarative `rule.alint.toml` files. Rules that prove generic move to `@lobehub/lint` as a published plugin later; repo-specific rules stay here.

## Rules

| Rule                               | Severity | Scope                                                         | Source of the rule                                                      |
| ---------------------------------- | -------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pmap-over-promise-all`            | error    | `apps/server/src`, `packages/database`                        | fan-out over a runtime-sized list needs `pMap`                          |
| `no-transactions-in-models`        | error    | `packages/database/src/models`                                | cross-aggregate write transactions use repositories                     |
| `no-effect-fetching`               | error    | `src/**/*.tsx`                                                | `data-fetching-architecture` skill                                      |
| `no-dynamic-import-in-server`      | error    | `apps/server/src`, `packages/database`                        | backend code uses static top-level imports                              |
| `no-mode-flags`                    | warn     | `src/**/*.tsx`                                                | `compose-atoms` skill                                                   |
| `no-unguarded-response-field`      | error    | `src/**/*.tsx`                                                | a newer client must survive an older server omitting a response field   |
| `no-node-in-browser`               | error    | browser code in `src/` (not `app/`, `libs/`), package `*.tsx` | no Node-only npm package where the SPA runs it (paths: ESLint)          |
| `no-unsafe-user-url-fetch`         | warn     | `apps/server/src`                                             | user-controlled URLs must use SSRF-safe transport (#16601)              |
| `no-unscoped-resource-mutation`    | warn     | database models/repositories                                  | ownership checks for resource and junction mutations (#13683, #16586)   |
| `no-untrusted-path-io`             | warn     | server and Electron main process                              | confine uploaded/remote filenames before filesystem IO (#13684, #13937) |
| `no-shell-command-injection`       | warn     | server, desktop main, CLI, agent/file-shell adapters          | shell interpolation and interpreter command strings (RCE)               |
| `no-untrusted-code-execution`      | warn     | server, desktop main, agent/file-shell adapters               | untrusted eval/Function/vm/interpreter execution (RCE)                  |
| `no-unsafe-html-execution`         | warn     | web, server, shared utilities                                 | HTML/SVG and artifact iframe XSS-to-RCE (#13529)                        |
| `no-unsafe-raw-sql`                | warn     | server and database                                           | raw values/identifiers entering SQL                                     |
| `no-secret-exposure`               | warn     | server, desktop main, CLI, web, env                           | credentials in logs, responses, public config (#19452)                  |
| `no-auth-verification-bypass`      | warn     | server, web auth shells/helpers                               | unverified JWT identity and fail-open signed webhooks                   |
| `no-unvalidated-redirect`          | warn     | server and web                                                | unvalidated return/callback targets                                     |
| `no-prototype-pollution`           | warn     | server, desktop main, shared utilities                        | untrusted keys/paths reaching prototype setters                         |
| `no-privileged-untrusted-electron` | warn     | Electron main/preload                                         | remote content with Node privileges or unrestricted IPC bridges         |
| `no-removal-only-tests`            | warn     | app/package/client test and spec files                        | tests should prove behavior, not merely that a retired option is absent |
| `no-redundant-api-copy`            | warn     | usage guides, builtin skills, CLI commands, public schemas    | keep ordinary instructions focused on supported actions                 |

Package-level rules, kept next to the package they describe:

| Rule                               | Severity | Scope                                                                        | Lives in                                    |
| ---------------------------------- | -------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| `hetero/agent-layering`            | error    | the browser-reachable layer of `heterogeneous-agents` and its spawn pipeline | `packages/heterogeneous-agents/alint/rules` |
| `hetero/host-capability-placement` | warn     | files owned by the browser entries of `heterogeneous-agents` (not barrels)   | `packages/heterogeneous-agents/alint/rules` |

`hetero/host-capability-placement` encodes two review rejections: code that only one Node host uses (the quota sampler, `lh hetero exec`, the desktop main process) moves behind a Node-only entry even when it is pure, and it is never made browser-portable to stay where it is. It reads one file, so it cannot see who imports a symbol; it reports only a host the file names itself, and misses host-only code whose docs do not say so.

`error` is reserved for rules measured at zero false positives on real PRs; an error turns the ALint check red. A rule starts at `warn` and is promoted only after its findings have been read on real PRs. A rule whose findings are mostly true but not worth acting on per PR does not belong here: `test-the-exit-not-the-entry` was removed after five days because it produced 92% of all findings and drowned out the rest.

**What belongs here, and what belongs in ESLint.** A check that an AST or a path list decides — an import path, a banned call, a naming pattern — goes into ESLint, where it is exact, free and runs in the editor. alint takes only what needs judgement: whether a list is runtime-sized, whether a table is another aggregate, whether an effect reads the server. Leaving a deterministic check to a model buys false positives: `no-node-in-browser` once flagged 34 imports on canary and 33 were type-only or browser-safe, while the same boundary written as `no-restricted-imports` (the browser runtime block in `eslint.config.mjs`) found exactly the one real violation. The model also emits findings whose own message concludes "no violation"; a prompt does not reliably suppress that, so every rule states its carve-outs as "return no finding".

Scopes are declared as `[[config.group]]` entries in the root `alint.config.toml`. Never scope a rule with `includeFiles` inside `rule.alint.toml`: it only filters reports, so every file still runs (double the jobs), and it marks the rule uncacheable.

## Where a rule lives

Rules come in two layers, and each layer is registered as its own plugin in `alint.config.toml`:

- **Repo-wide rules** live in `packages/alint/rules` under the `lobehub/` prefix. They state something true of a kind of code wherever it is, for example "browser code imports nothing Node-only" (`no-node-in-browser`).
- **Package-level rules** live next to the package they describe, in `packages/<pkg>/alint/rules` with their fixtures in `packages/<pkg>/alint/fixtures`, under a prefix of their own (`hetero/` for `heterogeneous-agents`). They encode that package's architecture, for example which of its layers the web app reaches (`agent-layering`), and are only ever scoped to that package.

A per-file rule cannot see an import graph. When a package's boundary matters, pair its package-level rule with a deterministic test of the graph: `heterogeneous-agents` lists its browser entries in `browser-entries.json`; `src/runtimeBoundary.test.ts` walks everything those entries reach and fails on Node built-ins, Node globals such as `Buffer`, or files owned by a Node-only entry, and the root ESLint config reads the same list to reject value imports of any other entry from `src/`.

To add a package-level rule: register the directory as a plugin in the rule's `[[config.group]]`, add a fixture group for it, and add its fixtures directory with the plugin prefix to `FIXTURE_ROOTS` in `fixtures.test.ts`. CI runs calibration when `packages/*/alint/**` changes.

## Removal review rules

The copy rule comes from the owner's review of task-prefix removal in
[#20687](https://github.com/lobehub/lobehub/pull/20687).

The test-value rules already added by
[#20672](https://github.com/lobehub/lobehub/pull/20672) are reused unchanged:
`no-removal-only-tests` covers dedicated absence checks for deleted implementation;
`no-constant-stub-tests` covers dedicated checks of inert endpoint constants.
They preserve runtime business, safety and compatibility behavior. Negative
assertions, default behavior and integration tests are not inherently violations.

`no-redundant-api-copy` reports removal announcements in ordinary product
instructions, tautological request-schema descriptions, and command summaries
that repeat default-policy text already visible in the same file. It preserves
useful field semantics, operational limits, migration guidance and internal
compatibility comments. A useful description of default behavior is allowed;
the model cannot tell from one file whether it was needlessly added in a removal PR.

The remaining requirements need a **diff-aware human review**, not a per-file
lint finding:

- Keep unrelated CLI descriptions unchanged; “这个 description 不要去改”.
- Delete tests for the removed customization rather than rewriting them into
  already-covered default cases. Existing coverage in other files is not visible
  to alint.
- Do not add an integration suite just to prove removal; “—— 没事不要新增集成测试”.
  A new filename alone does not establish that its coverage is unnecessary.
- Avoid changing usage guides, command references or builtin skill instructions
  merely to restate unchanged defaults. The task review explicitly reverted
  `commands.md`, both getting-started task guides and the task `SKILL.md`.
- Preserve original markup, including `\<task\_skill\_guides>`; the owner's quote is
  `保持之前用的 \<task\_skill\_guides> 吧（虽然我不清楚为啥要转义，但自有它的用意）`.

Do not turn these comments into a global prohibition on documentation, schema
descriptions, default-behavior tests or integration tests. Only locally established
patterns are automated. The new copy rule starts at `warn`; fixture calibration is separate
from the real-PR evidence required for promotion. This change is lint tooling and
does not change product behavior, so product acceptance is not required.

Initial calibration (2026-10-10, Codex ACP / `gpt-5.5`): all 11 new fixtures passed
in a cold run of the full 185-fixture suite. All 28 sampled real files completed
without findings; one ACP timeout was retried successfully. The sample had no
positive findings, so precision is not measurable. The full suite passed 181/185:
four unchanged legacy-rule fixtures were initially missed; a cold retry recovered
three, while `hetero/agent-layering` still missed `bad-adapter-reads-log.ts`.
These legacy rules and fixtures were left unchanged. This calibration does not
establish equivalent accuracy on the CI provider or justify promotion to `error`.
ACP reported zero token usage, which means accounting was unavailable, not that
the model run was free. Local provider setup and raw runs remain gitignored.

After shortening the instruction, fresh cold runs passed all 11 fixtures and
completed all 28 real sample files without findings, failures or cache hits.

## Security rules

The twelve security rules combine regressions from actual fixes with other common
injection and trust-boundary mistakes. They use concrete source-to-sink checks.
Historical anchors:

- **SSRF:** [#16601](https://github.com/lobehub/lobehub/pull/16601)
  (GHSA-53h9-fmjf-frwr) replaced raw fetch for imported skill/image URLs with
  `@lobechat/ssrf-safe-fetch`. URL parsing or HTTPS-only validation is insufficient.
  Fixed destinations, administrator configuration, and unknown URL provenance are
  excluded to avoid treating every backend fetch as vulnerable.

- **IDOR:** [#13683](https://github.com/lobehub/lobehub/pull/13683) added target
  knowledge-base ownership checks; [#16586](https://github.com/lobehub/lobehub/pull/16586)
  scoped group-membership deletion. Relation creation must account for both endpoints;
  deleting ownership-scoped junction rows does not require redundant endpoint checks.
  Workspace ownership, fail-closed parent guards, and documented privileged primitives
  are recognized. Cross-file caller authorization still needs human verification.

- **Path traversal:** [#13684](https://github.com/lobehub/lobehub/pull/13684)
  (GHSA-2g9j-v25c-4j97, temporary-file overwrite) and [#13937](https://github.com/lobehub/lobehub/pull/13937) sanitized
  untrusted filenames. `join`/`resolve` alone and bare string-prefix containment are
  unsafe. Flat private temp stores, properly confined nested paths, generated names,
  and filesystem tools with explicit approved-path guards are accepted.

- **HTML artifact XSS-to-RCE:** [#13529](https://github.com/lobehub/lobehub/pull/13529)
  (GHSA-xq4x-622m-q8fq) introduced HTML sanitization and iframe sandboxing.
  The HTML rule covers the injection entry point; the Electron rule covers the
  privilege boundary that can turn renderer script execution into host execution.

- **Credential disclosure:** [#19452](https://github.com/lobehub/lobehub/pull/19452)
  removed credentials from bot inventories and masked detail reads. The secret rule
  distinguishes accidental logging/list disclosure from intentional issuance to
  an authenticated credential owner.

Additional coverage targets shell command construction, dynamic host code execution,
raw SQL, JWT/webhook verification, callback redirects and object prototype mutation.
RCE is an impact, so it is covered at several entry points: command injection,
untrusted code execution, writable paths, HTML artifacts, and Electron privileges.
A Node `vm` context is not treated as an isolation boundary. An argument array still
needs scrutiny when its target is `bash -c`, `node -e`, or another interpreter.

Safe patterns have explicit carve-outs: approved agent terminals, isolated code
sandboxes, parameterized SQL, sanitized HTML, opaque-origin sandboxed previews,
verified claims, fixed/validated redirects, redacted credentials, null-prototype
records, and narrow Electron bridges. Dynamic execution features are not blanket
violations. A rule needs visible evidence that its trust boundary is missing.

The security fixtures include unsafe examples and legitimate exceptions. They use
illustrative imports, like the existing fixtures, and are analyzed as source text,
not executed as application code. New rules start at `warn`; model-backed per-file
lint cannot establish exploitability across callers or replace security review.
Only tooling changes are involved, so product acceptance is not required.

Calibration details and known limitations are recorded in
[security-calibration.md](security-calibration.md). Rules remain `warn`: per-file
analysis can miss caller authorization, vary between runs, or misread large files.
No zero-false-positive or complete-vulnerability-coverage claim is made.

## Setup and run

```bash
export ALINT_API_KEY=...     # or DEEPSEEK_API_KEY
bun run alint:setup          # writes .alint/config.toml (gitignored)
bun run alint plugin install # registers ./packages/alint/rules (once, and after adding a rule)

bun run check --alint          # changed lines of changed files, like CI
bun run check --alint src/a.ts # explicit paths are linted whole
bun run alint --dirty          # the same scope as the first line, alint's own reporter
bun run alint src/features/Foo # any files or directories
```

Defaults are DeepSeek `deepseek-flash` at `https://api.deepseek.com/v1`; override with `ALINT_PROVIDER_ENDPOINT` and `ALINT_MODEL`. Any OpenAI-compatible endpoint with tool calling works. `thinking` is disabled on the model because alint forces a tool call for structured output and DeepSeek V4 rejects that while reasoning is on.

Treat findings like a reviewer's comment: fix them, or explain in the PR why the rule's carve-out applies. Locally, `bun run check --alint` fails on `error` findings like any other lint error.

## Promotions, 2026-10-01

Read from every ALint check run on the 126 pull requests active 2026-09-29 → 10-01 (298 runs, 34 distinct warnings), each finding checked against the code:

- `no-dynamic-import-in-server` → `error`: 3 of 3 findings true, and all 3 were left in place, 2 of them merged. A warning nobody acted on is the case for a red check.
- `ui-button-hierarchy` → `error`: 7 true, 1 false (a mapped option row where only the recommended option is primary, now a carve-out with a fixture), 1 borderline.

Every summary now ends with the run's cost — model calls, cache hits, input and output tokens — so spend can be read back from the check runs instead of estimated.

## CI

The `alint ·` steps at the end of the "ALint & Test Desktop App" job in `.github/workflows/test.yml` run on every push and pull request, on the change's diff only (they reuse that job's root install instead of paying for a runner of their own). The desktop job itself never fails because of alint:

- `alint --dirty` lints the working tree against `HEAD` and keeps only findings on changed lines. The steps fetch the merge base (against the PR base, or `canary` on a push) and run `git reset --mixed <merge-base>`, which turns the whole change into dirty changes, so the scope is exactly its diff and nothing older is reported. On a push to `canary` itself the diff is empty and nothing runs.
- `packages/alint/report.ts` publishes the result as a separate **ALint** check run on the head commit: red when any `error` finding exists, neutral with only warnings, green when clean. Findings are attached to it as line annotations. The check is not a required status, so it does not block merging, but a red check reaches whoever watches CI, including agents woken by CI failures.
- The same table goes into one summary comment on the open PR for the branch, rewritten in place on every push. It is created only once there is something to report; when a later push is clean the comment flips to a green verdict instead of disappearing.
- Findings on the calibration fixtures are dropped from the check and the comment; the fixture suite covers them.
- The provider key comes from the `DEEPSEEK_API_KEY` repository secret. Fork PRs cannot read it, so the steps are skipped.
- When `alint.config.toml` or anything under `packages/alint` changed, the fixture suite runs too, so a rule edit is calibrated before it lands.
- `.alintcache` is restored from the latest run whatever the rule set. Since alint 0.7.2 each cached result is keyed by its rule's own text, include/exclude lists and severity, so editing, adding or re-levelling one rule re-runs only that rule; everything else stays cached.

## Cost and behaviour, measured 2026-09-20

| Run                                   | Jobs | Wall | Tokens     |
| ------------------------------------- | ---- | ---- | ---------- |
| 80 files (20.8k lines), 2 rules, cold | 80   | 23 s | 290k input |
| same, warm cache                      | 0    | 2 s  | 0          |
| one file changed                      | 1    | 3 s  | 873        |

About 14 input tokens per source line per rule. Two cold runs over the same files differed by one finding; a finding can appear or vanish between runs, which is why fixtures exist and why only rules measured at zero false positives are promoted to `error`.

## UI review rules

The `ui-*` rules encode the product owner's recurring acceptance rejections. They were distilled from 620 review comments on 92 acceptances over 30 days (2026-08-30 to 2026-09-29); each rule quotes the comments it comes from, so the standard stays the owner's words rather than a paraphrase. About half of those comments are requirement or taste calls no rule can hold; the rules cover the part that recurs and can be read off one file.

| Rule                      | Where            | Sample precision | Whole repo | What it holds                                                                         |
| ------------------------- | ---------------- | ---------------- | ---------- | ------------------------------------------------------------------------------------- |
| `ui-button-hierarchy`     | PR check (error) | narrowed         | 62         | only two primaries in one group, a primary on every list row, a small empty-state CTA |
| `ui-lightweight-errors`   | PR check         | \~70%            | 73         | one readable error line, raw details folded                                           |
| `ui-content-width`        | PR check (pages) | \~100%           | 7          | page bodies sit in `SettingContainer` or a max-width column                           |
| `ui-edit-in-modal`        | PR check         | \~57%            | 36         | edit / rename / add opens a modal, not an inline input or a popover input             |
| `ui-view-switch-tabs`     | PR check         | \~50%            | 20         | whole views switch with `Tabs`, the active tab in the URL                             |
| `ui-no-decorative-chrome` | audit            | \~56%            | 1441       | no wrapper borders, fills, restating titles, bold labels, extra dividers              |
| `ui-restrained-color`     | audit            | \~53%            | 830        | color for state only; gray metadata and types; tokens, not literals                   |
| `ui-user-facing-copy`     | audit            | \~53%            | 768        | no raw enums, hard-coded strings or jargon on screen                                  |
| `ui-in-app-links`         | audit            | \~60%            | 30         | links match the router's shapes and carry no marker params                            |

`ui-button-hierarchy` was narrowed after review to three patterns a single file can decide; which action deserves the primary, and whether a secondary should be `fill`, is left to review. Sample precision is measured on the same 20-finding samples the carve-outs were written from, so it is optimistic. Rules with many findings or weak precision run only in the audit (`bun run alint:audit`, `alint.audit.toml`): reported on every PR they would drown the sharper rules, as `test-the-exit-not-the-entry` once did. `ui-in-app-links` cannot see the route table from one file; a test that matches literal in-app paths against the router is its real home. `text-transform: uppercase` is a deterministic check: stylelint (`declaration-property-value-disallowed-list`) and ESLint (inline `textTransform`) report it as an error.

## Whole-repo calibration, 2026-09-29

Every rule was run cold over all of canary (apps/server, packages, src: 14.7k model calls, 40M input tokens, about 10 minutes at `--rule-concurrency 32`), and each finding was read or sampled. Findings are legacy code; CI and `check --alint` only report changed lines, so they surface when someone edits that line.

| Rule                          | Before | After | What changed                                                                                                                                                        |
| ----------------------------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-node-in-browser`          | 34     | 0     | 33 were type-only (`import { type X }` is erased without `verbatimModuleSyntax`) or browser-safe; the path part moved to ESLint, which found the one real violation |
| `no-transactions-in-models`   | 109    | 51    | redefined on aggregates: owned child rows, event / history rows, link rows and cascade deletes are the same aggregate                                               |
| `no-mode-flags`               | 98     | 17    | only flags that name a host (`inShare`, `embedded`, `mobile` page compositions) and gate fetching or editing                                                        |
| `no-effect-fetching`          | 48     | 43    | writes then refresh, prefetch, auth / QR handshakes, locale chunks and repeat call sites dropped; store actions fetching on mount added                             |
| `pmap-over-promise-all`       | 211    | 216   | high precision; code-level registries (adapter maps) no longer reported                                                                                             |
| `no-dynamic-import-in-server` | 51     | 51    | matches the rule as written; promoted to `error` on 2026-10-01                                                                                                      |
| `hetero/*`                    | 0      | 0     |                                                                                                                                                                     |

Known remaining false positives: `no-transactions-in-models` still reports a subtype row deleted with its `user_memories` base row and a topic usage rollup recomputed after a message write (six findings) — one file at a time the model sees another table with its own Model.

## Adding a rule

1. Create `rules/<name>/rule.alint.toml` with `name`, `builtInAgent = "basic-structured"`, and an `instruction`. Write the rule as the reviewer would: what to report, which line to anchor on, what the message and suggestion must contain, and an explicit "do not report" list. The carve-outs are where the false positives live.
2. Add a `[[config.group]]` for its scope in `alint.config.toml`, and a fixture group `packages/alint/fixtures/<name>/**`.
3. Add fixtures under `fixtures/<name>/`: at least one `bad-*` file with a standalone `// alint-expect` comment (`{/* alint-expect */}` inside JSX) on the line above the one the finding must anchor to, and one `good-*` file per carve-out. Keep them short and realistic.
4. Run `bun run alint plugin install`, then `cd packages/alint && bunx vitest run fixtures.test.ts` with a provider set up. The suite skips itself when there is no setup. The cache is keyed by the rule's text, so an edited rule re-runs on its own; no need to delete `.alintcache`.
5. Before enabling the rule on a scope, run it over a few dozen real files and read every finding.
