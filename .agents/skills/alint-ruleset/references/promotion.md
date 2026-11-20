# Promotion — `warn` → `error`

`error` turns the ALint check red and reaches whoever watches CI, including agents woken by a
CI failure. `warn` sits on a green check and is widely ignored — in the 2026-09 review pass,
7 of 11 non-test findings were merged as-is. So promotion is how a rule acquires teeth, and it
must be earned on real data, never on the calibration sample.

## The evidence

Promote from the rule's findings on **real pull requests**, not from a local scan. Gather the
window with [`scripts/pull-alint-runs.ts`](../scripts/pull-alint-runs.ts), which reads the
`ALint` check runs (and their annotations) plus the summary comment for each PR:

```bash
bun .agents/skills/alint-ruleset/scripts/pull-alint-runs.ts --days 7 --out /tmp/alint-ci
# → /tmp/alint-ci/worksheet.json  +  /tmp/alint-ci/by-rule.md
```

Deduplicate on **PR + rule + file + message**, then keep whether the finding is still present
in that PR's **latest** run. A finding that disappeared was fixed or explained; only standing
findings count. Then read each standing finding against the source and mark it TP / FP /
borderline. The script gathers and tallies; it never judges.

## The gate

Promote a rule to `error` only when **all** hold:

1. Every standing finding in the window is a true positive (zero FP, allowing for the model's
   run-to-run noise).
2. The finding is worth surfacing on **every** PR that touches that line, not just worth
   knowing once.
3. There is enough volume to mean something — one or two findings is not evidence.
4. Any FP already seen has been turned into a carve-out **with its `good-*` fixture** and
   re-verified cold.

If the shape is "mostly true but not worth acting on per PR" or precision is in the 50–70%
band, the rule does not get `error`; it stays `warn`, or moves to `alint.audit.toml`.

## What not to do

- Do not promote on the calibration sample. Its precision is optimistic by construction.
- Do not promote a judgement-call rule whose FP is a matter of context another file holds.
- Do not promote a rule with no PR data yet — a brand-new rule waits for a window of real runs.
- Do not bundle promotions with unrelated rule edits. Promotion is a small, reviewable PR that
  changes severity (and, if needed, adds the carve-out + fixture). Combine only when the owner
  asks for it.

## After promotion

- The rule now turns the check red **on changed lines**. Legacy findings do not fail CI, but
  whoever edits one of those lines will go red — list the known legacy spots in the PR so it
  is a known bill, not a surprise.
- The check is not a required status: a red check informs and wakes watchers, it does not block
  merging. Say that plainly instead of promising enforcement.
- Promotion may create a real cost: a rule that reports on every backend file multiplies the
  per-file calls. Re-check the cost after a promotion (see [cost.md](cost.md)).

## Reading the window correctly

Release PRs (base `main`) re-report days of changes as "changed lines", so they dominate the
raw volume. Their findings are still real changed-line findings, so they count — but do not let
them hide that a rule simply has no organic traffic. Check a rule's sample size before acting.
