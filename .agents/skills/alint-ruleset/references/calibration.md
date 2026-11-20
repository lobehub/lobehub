# Calibration

Calibration is the work that turns a plausible prompt into a rule worth running on every PR:
scan the real repo, read a sample of findings against the source, and write the false-positive
patterns back into the instruction as carve-outs. A rule is not calibrated until a cold run
of its fixtures reproduces both the findings and the carve-outs.

## A · Collect the standard

The standard is the owner's review rejections, not our paraphrase of them. Pull the window
with [`scripts/collect-rejections.ts`](../scripts/collect-rejections.ts), which wraps
`lh acceptance list` + `lh acceptance feedback <id>` into one grouped dump:

```bash
bun .agents/skills/alint-ruleset/scripts/collect-rejections.ts --days 30 --out /tmp/alint-rejections
```

Read every comment. Then split them:

- **Becomes a rule** — the complaint recurs, and a single file contains the evidence. Quote it
  verbatim in the rule; keep the original language.
- **Not a rule** — a requirement, a state the reviewer wanted that the file cannot reveal, or a
  one-off taste call. These belong to review, the `ux` skill, or an acceptance check.
- **Not alint at all** — decided by an AST or a path list. That is ESLint/stylelint.

In the 2026-09-29 pass, 620 comments over 92 acceptances became 9 `ui-*` rules; about half the
comments were requirement or taste calls no rule can hold.

## C · Calibrate

### 1. Scan

```bash
bun run alint plugin install
rm -rf .alintcache                                  # an edited rule must not replay old results
node_modules/.bin/alint --format json --rule-concurrency 32 <scope...> > /tmp/alint-scan/raw.json
```

`--rule-concurrency 32` is the working figure for a whole-repo scan (about 10 min for
`apps/server`, `packages`, `src`; ~14.7k model calls, ~40M input tokens). For a single rule
being iterated, scan its scope only — a full cold scan is the cost driver (see
[cost.md](cost.md)).

### 2. Sample

Use [`scripts/sample-findings.ts`](../scripts/sample-findings.ts) to turn `raw.json` into one
`sample-<rule>.txt` per rule (default 20 findings each), in the form the classifier reads:

```bash
bun .agents/skills/alint-ruleset/scripts/sample-findings.ts /tmp/alint-scan/raw.json --sample 20 --out /tmp/alint-scan
# → /tmp/alint-scan/sample-ui-button-hierarchy.txt : "file:line  confidence  message  suggestion"
```

### 3. Classify — TP / FP / DUP

Open the actual file at each line and judge. This is a **read-only** pass: do not edit the
tree while classifying. Dispatch it to sub-agents, one batch of ~3 rules per agent, with this
prompt:

> You are calibrating model-backed lint rules for the LobeHub repo. Work read-only in
> `<worktree>` (do not edit any file there).
> For each of these rules: `<rule-a>`, `<rule-b>`, `<rule-c>`
> 1. Read the rule definition at `packages/alint/rules/<rule>/rule.alint.toml`. It contains the
>    product owner's own review quotes; those quotes ARE the standard. Judge like that owner.
> 2. Read `/tmp/alint-scan/sample-<rule>.txt` (20 sampled findings: file:line, confidence,
>    message, suggestion).
> 3. For every finding, open the file at that line (read enough surrounding code) and classify:
>    **TP** (a real violation the owner would want changed, per the rule text),
>    **FP** (not a violation — name the exclusion or the misread),
>    **DUP** (same issue already reported by another finding in the sample).
>    Note repo conventions: UI comes from `@lobehub/ui/base-ui`; styles use `createStaticStyles`
>    + `cssVar`.
> Report per rule: counts TP/FP/DUP and precision = TP/(TP+FP); one line per finding
> (index, verdict, 1-sentence reason); the **recurring FP patterns, each phrased as a concrete
> "do not report X" sentence**; and the 3 most valuable TPs (file:line and what is wrong).
> Under 900 words.

For a rule about links or routes, the classifier must check the real router
(`src/spa/router/*`, redirects in `src/libs/next/config/define-config.ts`) — a link is only a
TP if it truly does not resolve.

### 4. Write the carve-outs back

Each recurring FP pattern becomes one sentence in the instruction's **do not report** list,
phrased the way a reviewer would say it ("a primary button inside an inline notice: when it is
the notice's one way forward, primary is right"). Add one `good-*` fixture per carve-out, taken
from the real false positive. Then re-read the rule end to end: a carve-out that contradicts a
report pattern means the report pattern is too broad — narrow it (this is how
`no-transactions-in-models` went from "writes two tables" to "writes another aggregate", and
`ui-button-hierarchy` from "a primary per item" to three decidable patterns).

### 5. Prove it cold

```bash
rm -rf .alintcache
cd packages/alint && bunx vitest run fixtures.test.ts      # the whole suite, not just the edited rule
```

Then re-scan the files that were reported and confirm the false positives are gone **and the
carve-out did not eat the true positives** — read the diff of the two finding sets, not just
the count.

## D · Map the problems

After a full scan, cluster the remaining findings by file and by feature area, across rules.
The files hit by several rules are the cleanup backlog worth proposing first; a single rule's
long tail is usually not. Report the map as a table (area, rules, count, example `file:line`).

## Evidence boundary

- Precision measured here is measured on the sample the carve-outs were written from, so it is
  **optimistic**. Say so whenever it is quoted.
- Findings on legacy code are expected: CI and `check --alint` only report **changed lines**, so
  an old violation surfaces only when someone edits that line.
- Two cold runs over the same files can differ by a finding — the model is not deterministic.
  This is why fixtures exist and why only zero-false-positive rules are promoted.
- One file at a time is the model's whole world. A rule cannot see who imports a symbol or what
  a route table contains; do not promise it can.
