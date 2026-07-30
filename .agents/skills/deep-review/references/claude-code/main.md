# Deep Review · Claude Code Manual

Deep mode in Claude Code, end to end. Every Task prompt is self-contained; never rely on inherited
conversation context.

Use a balanced/fast model tier for review and verification. Rules carry the quality.

## Step 0 — Scope and background

Follow [`../scoping.md`](../scoping.md). Produce `{changes}`, a ≤ 200-word scope summary, and PR
metadata in PR mode.

## Step 1 — Select dimensions

1. Apply `SKILL.md` pruning and record each skipped dimension with one reason.
2. Detect sibling `deep-review-*` extension packs. Collect built-in plus extension paths for every
   surviving dimension; extension-only files add dimensions.

## Step 2 — Spawn reviewers

Launch every selected dimension concurrently in one response, one Task per dimension.

Instantiate [`../review-prompt.md`](../review-prompt.md) with `{dimensions}`, `{dimension_files}`,
`{scope_summary}`, and `{changes}`. Use `description: review: <dimension>` and
`subagent_type: general-purpose`.

## Step 3 — Validate, aggregate, and verify

Maintain these accumulators for the entire run:

- `reportPool`
- `releaseChecks`
- `missingSources`
- `workflowFeedback`
- `needsContext`
- verification statistics

On every reviewer return:

1. Validate the fenced payload with
   `bun run .agents/skills/deep-review/scripts/validate-output.ts review`, passing the response on
   stdin or through a task-scoped temp file. Validation failure → reject and re-spawn the reviewer
   with the same prompt.
2. Append `missing_sources`, `release_checks`, and `workflow_feedback` to their accumulators before
   partitioning findings.
3. Findings from `verify: false` dimensions go directly to `reportPool`.
4. For verifiable findings, instantiate [`../verify-prompt.md`](../verify-prompt.md). Include only
   the dimension-specific verification addenda that the payload requires. Spawn verification as
   soon as that reviewer returns; do not wait for other reviewers.

On every verifier return:

1. Validate with `validate-output.ts verify`.
2. Compare input and output ids one-to-one. Missing, duplicate, or invented ids → spawn a fresh
   verifier for the unresolved original ids.
3. Apply `severity_override` and the nature/exposure overrides before cross-checking invariants:
   effective P0 must block release, effective P2 must not, and effective `release-risk` or
   `exposed_legacy` findings must not be auto-fixes. Re-spawn a verifier only when the effective
   values still violate these invariants.
4. Append verifier `workflow_feedback`.
5. `confirmed` → `reportPool` after applying overrides; `false_positive` → statistics only;
   `need_more_context` → `needsContext`.

Split a verifier payload only when it exceeds 20 findings. Never let the main agent re-verify a
candidate.

## Step 4 — Consolidate duplicate roots

When at least two confirmed findings remain, spawn one fresh Task using
[`../consolidate-prompt.md`](../consolidate-prompt.md). Pass confirmed findings after verifier
overrides, in report order.

Validate the result with `validate-output.ts consolidate`, then reject any invented id, self-map,
cycle, or root that occurs after its duplicate. Invalid output → re-spawn consolidation. Apply the
map only after validation.

Zero or one confirmed finding skips this step.

## Step 5 — Render the report

Render strictly per [`../report-template.md`](../report-template.md). Include the aggregated missing
sources and workflow feedback, optional consolidation in the execution line, statistics, and the
PR-mode merge verdict. Run the template's pre-send self-check.

## Step 6 — Offer the safe batch

When `Safe to fix now` is non-empty, use `AskUserQuestion`:

- Question: `"Safe to fix now" has N low-risk findings — apply them all in one pass?`
- Options: `Fix all` / `Not now`; free text covers partial picks.

Apply selected fixes and regression tests where `need_test: true`. Empty batch skips silently.

## Step 7 — Walk remaining decisions

Ask about confirmed `can_auto_fix: false` findings and `needsContext`, up to four questions per
call. Order P0 → P1 → P2, blocking first. Exclude every legacy hand-off item. Skip low-likelihood,
non-blocking items on repeat review unless the user asks.

## Step 8 — Offer legacy hand-off issues

When `Hand off to owner` is non-empty, ask once whether to create all, some, or no Linear issues.
Create nothing before approval. On approval, use the `linear` skill and include location, culprit,
scenario, likelihood, and verification evidence.

## Notes

- Small diff: ≤ 200 lines and ≤ 5 files; inline it. Otherwise pass fetch commands.
- PR mode: GitHub URL or unambiguous `PR #123` / `pr 123` / `pull request 123`; a bare `#123` is not.
- If Tasks cannot be spawned, stop and offer light mode. Never simulate deep mode in the main agent.
