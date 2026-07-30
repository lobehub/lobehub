# Deep Review · Codex Manual

Deep mode in Codex, end to end. Every spawned agent receives a self-contained prompt.

## Runtime contract

Inspect the collaboration tools already exposed in the session before spawning. Use deferred-tool
discovery only when the session explicitly says collaboration tools are deferred.

Bind these capabilities from the real schemas:

- spawn
- wait for any completion
- optional explicit close/release
- context inheritance control
- active concurrency limit

Set context inheritance explicitly to none. If inheritance cannot be disabled, disclose weakened
independence in the report. If spawning is unavailable, stop and offer light mode.

Define one `release(agent)` operation from the documented lifecycle:

- completion automatically releases an active slot → no-op;
- a finished agent holds its slot until explicit close → close it;
- slot reuse cannot be determined or achieved → stop and offer light mode.

Do not select the algorithm merely from whether a close verb exists. Slot reuse is the capability
that matters.

## Group table

Codex packs related dimensions to fit the normal three usable subagent slots:

| Group         | Dimensions                                                               |
| ------------- | ------------------------------------------------------------------------ |
| `quality`     | ai-coding-bad-habits, code-style, reuse-architecture, business-logic, ux |
| `correctness` | logic, performance, security, compatibility                              |
| `release`     | release-risk                                                             |
| `process`     | workflow, skill-freshness, observability                                 |

Pruning removes dimensions; empty groups disappear. Start `release`, `correctness`, and `quality`
first so the largest evidence passes begin immediately; queue `process`. Use a fast tier for
`process` and a balanced tier elsewhere.

Extension-only dimensions form an `extras` group and join the same queue. Never drop it.

## Step 0 — Scope and background

Follow [`../scoping.md`](../scoping.md). Produce `{changes}`, a ≤ 200-word scope summary, and PR
metadata in PR mode.

## Step 1 — Select dimensions and references

Apply `SKILL.md` pruning, detect sibling extension packs, and collect built-in plus extension paths.
Dimension files may route to surface-specific references; agents read only the routes matching the
diff.

## Step 2 — Build prompts

For every non-empty group, instantiate [`../review-prompt.md`](../review-prompt.md) with
`{dimensions}`, `{dimension_files}`, `{scope_summary}`, and `{changes}`. Set the discovered
inheritance control to none.

## Step 3 — Run the work queue

Maintain:

- `pendingWork`: not-yet-spawned review, review-retry, verify, and verify-retry items
- `active`: spawned work keyed by agent id
- `reportPool`
- `releaseChecks`
- `missingSources`
- `workflowFeedback`
- `needsContext`
- verification statistics

Seed `pendingWork` in this order: `release`, `correctness`, `quality`, `process`, `extras`. Fill every
usable slot.

Whenever an agent completes:

1. Call `release(agent)`.
2. Remove it from `active`.
3. Validate its fenced payload with
   `bun run .agents/skills/deep-review/scripts/validate-output.ts <review|verify>`, passing the
   response on stdin or through a task-scoped temp file.
4. On invalid review output, prepend the identical review retry to `pendingWork`. On invalid verify
   output, prepend a retry for the unresolved original ids.
5. Handle valid output as described below.
6. Refill every free slot from `pendingWork`.

The loop ends only when `active` and `pendingWork` are both empty.

### Valid review output

Append `missing_sources`, `release_checks`, and `workflow_feedback` before partitioning findings.

- `verify: false` findings → `reportPool`
- verifiable findings → append one verify item using [`../verify-prompt.md`](../verify-prompt.md),
  including only the required verification addenda
- zero verifiable findings → no verify item

### Valid verify output

Compare input and output ids one-to-one. Missing, duplicate, or invented ids invalidate those
entries; prepend a fresh verify item for unresolved original ids.

- Apply `severity_override` and the nature/exposure overrides before cross-checking invariants:
  effective P0 must block release, effective P2 must not, and effective `release-risk` or
  `exposed_legacy` findings must not be auto-fixes. Only a mismatch in the effective values returns
  that id to the verify queue.
- append verifier `workflow_feedback`
- `confirmed` → apply overrides and append to `reportPool`
- `false_positive` → statistics only
- `need_more_context` → `needsContext`

The main agent never re-verifies a candidate.

## Step 4 — Consolidate duplicate roots

After the queue drains, if at least two confirmed findings remain, spawn one fresh agent using
[`../consolidate-prompt.md`](../consolidate-prompt.md). Pass confirmed findings after overrides and
in report order.

Validate with `validate-output.ts consolidate`. Reject invented ids, self-maps, cycles, or roots
that occur after their duplicates; retry consolidation until valid. Apply the map only after those
checks. Zero or one confirmed finding skips consolidation.

## Step 5 — Render

Render strictly per [`../report-template.md`](../report-template.md), including aggregated missing
sources and workflow feedback, optional consolidation, statistics, and PR-mode merge verdict. Run
the pre-send self-check.

## Step 6 — Offer the safe batch

When non-empty, use `request_user_input` once:
`"Safe to fix now" has N low-risk findings — apply them all in one pass?`
with `Fix all` / `Not now`; free text covers partial picks. Apply tests where `need_test: true`.

## Step 7 — Walk remaining decisions

Ask one finding at a time for confirmed `can_auto_fix: false` items and `needsContext`, ordered P0 →
P1 → P2 and blocking first. Exclude legacy hand-offs. Skip low-likelihood, non-blocking items on
repeat review unless requested.

## Step 8 — Offer legacy hand-off issues

When legacy hand-offs exist, ask once whether to create all, some, or no Linear issues. Create
nothing before approval. On approval, use the `linear` skill and include location, culprit,
scenario, likelihood, and verification evidence.

## Notes

- Small diff: ≤ 200 lines and ≤ 5 files; inline it. Otherwise pass fetch commands.
- PR mode: GitHub URL or unambiguous `PR #123` / `pr 123` / `pull request 123`; a bare `#123` is not.
- Increasing concurrency may start all four built-in groups together; the same queue algorithm
  remains valid.
