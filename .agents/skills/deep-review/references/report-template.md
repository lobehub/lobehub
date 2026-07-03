# Final Report Template

This file is deep mode's **output contract** and overrides any environment-default review format. Render the full report; never compress the result into a plain findings list. Write the report in the conversation's language — the structure below is the contract, the wording translates.

Only `verdict: confirmed` findings are rendered (plus unverified dimensions — see below). Order: severity p0 → p1 → p2; within a severity bucket, group by dimension in table order from `SKILL.md`; within a dimension keep reviewer order.

## Rendering rules

- **Structure is mandatory**: title, header metadata, TL;DR, Findings, Statistics always render — even with zero confirmed findings (then Findings states "no confirmed findings" and Statistics still shows the counts).
- **Nature line**: `nature: "introduced"` → omit the line (default). `nature: "exposed_legacy"` → render `**Nature**: legacy surfaced by this change`.
- **Issue type** renders the finding's `issue_type` verbatim — never the dimension name.
- **Blocks release** renders verify's `blocks_release` (`yes`/`no`) on every confirmed finding — this is the user's ship/no-ship signal; never omit. Same-root merged entries take the value belonging to the highest merged severity.
- **Existing implementations** line only for `reuse-architecture` dedup findings, listing all entries.
- **Rule source** line renders the finding's `rule_source` when present.
- Apply `fix_options_override` / `nature_override` before rendering.
- **Same-root merge**: findings with `same_root_as: X` fold into X's entry — no separate number; add `**Same root**: id (location, issue_type), ...` at the entry's end; entry severity upgrades to the highest among merged; statistics count merged entries once.
- **P2 cap (noise control)**: if confirmed P2 count > 6, render the top 6 fully and collapse the rest into one line each under `More P2`: `**#n** [issue_type] summary (file:line)`.
- Empty severity buckets omit their heading entirely.
- **Unverified dimensions**: `workflow` findings render under `Process`, `skill-freshness` under `Skill updates` — outside the severity buckets, excluded from P0/P1/P2 statistics. These findings use the same JSON schema as everything else; render one line each mapped from those fields: fact = `summary`, evidence = `location` (plus `scenario` when present), suggested action = the first `fix_options` entry. Their `severity` is advisory and never rendered.
- **Missing sources**: if any reviewer returned `missing_sources`, append a note recommending the listed rule files be fixed/restored.
- **Workflow feedback**: merge equivalent suggestions across subagents, accumulate sources (`sources: code-style, verify`), render at the end; omit the section when empty.
- **PR mode** (the user's message contains a GitHub PR URL): render `Merge verdict` between TL;DR and Findings. Otherwise omit the section entirely. Bare `#123` / `pr 123` do NOT trigger PR mode.

### Merge verdict decision table (PR mode; main agent fills, never delegated)

First match wins:

| Condition                         | Verdict          |
| --------------------------------- | ---------------- |
| `isDraft: true`                   | do not merge yet |
| `mergeable: "CONFLICTING"`        | do not merge yet |
| any check `conclusion: "FAILURE"` | do not merge yet |
| P0 confirmed > 0                  | fix before merge |
| P1 confirmed > 0                  | fix before merge |
| otherwise (P2 only / clean)       | good to merge    |

Severity only — nature does not matter (a confirmed exposed-legacy P0 still blocks). Fallbacks: `mergeable: "UNKNOWN"` → treat as mergeable; all checks in progress/queued → CI pending, not blocking; no checks configured → CI pass. "fix before merge" lists all P0/P1 numbers + one-line summaries as prerequisites; "good to merge" lists P2s as follow-ups.

## Pre-send self-check

Before sending, confirm every item; fix and re-render if any is missing:

- Title + header metadata (scope / background / execution mode with pruned dimensions)
- TL;DR present; Findings present (or explicit "no confirmed findings"); Statistics present
- Every confirmed finding has: issue type, location, blocks release, core problem, evidence, fix cost, fix options, needs test
- Merge verdict only in PR mode

---

```markdown
# Deep Review Report

**Scope**: {e.g. `feat/user-batch-delete` vs local `main`, 8 files +240/-37, incl. submodule lobehub}
**Background**: {1-2 sentence core of the step-0 scope summary}
**Execution**: {N} dimension reviewers ({list}) + {M} verifiers; pruned: {dimension — one-line reason, or "none"}

## TL;DR

{1-2 sentences: X confirmed (P0 a / P1 b / P2 c, K legacy-surfaced), the single biggest risk, one suggested next action.}

> Only findings related to this change are kept. Findings marked "legacy surfaced by this change" live in old code that this diff triggers or depends on; everything else is newly introduced.

📣 {N} workflow feedback item(s) at the end of this report ← only when workflow_feedback is non-empty

## Merge verdict ← PR mode only

**Verdict**: {good to merge | fix before merge | do not merge yet}
**Basis**: P0 {x} / P1 {y} / P2 {z} confirmed | CI {pass|fail|pending} | draft {yes|no} | mergeable {ok|conflicting}
**Prerequisites**: #{n} {summary} ← "fix before merge" only
**Follow-ups**: #{n} {summary} ← "good to merge" with P2s only

---

## 📌 Findings

### 🔴 P0 ({n})

#### 1. {summary}

- **Issue type**: {issue_type}
- **Location**: `src/api/user.ts:87`
- **Blocks release**: yes
- **Nature**: legacy surfaced by this change ← exposed_legacy only
- **Existing implementations**: `src/foo.ts:62-138`, ... ← reuse dedup only
- **Rule source**: {rule_source} ← when present
- **Core problem**: {core_problem}
- **Scenario**: {scenario}
- **Evidence**: {verify evidence}
- **Fix cost**: low
- **Fix options**:
  - Option A: ...
  - Option B: ...
- **Needs test**: yes
- **Same root**: {id} ({location}, {issue_type}) ← merged entries only

### 🟡 P1 ({n})

...

### 🟢 P2 ({n})

...

**More P2** ← only when P2 > 6

- **#{n}** [{issue_type}] {summary} ({file:line})

---

## 🔁 Process ← workflow dimension findings, omit when empty

- {summary} — {location}{; scenario when present}; suggested: {fix_options[0]}

## 📚 Skill updates ← skill-freshness findings, omit when empty

- {location: stale skill file:line or proposed skill} — {summary}; suggested: {fix_options[0]}

## Statistics

- Confirmed: {n} ({k} legacy-surfaced) | False positives: {fp} (incl. {os} over-scrutiny) | Need more context: {nc}
- Must-fix this round: {p0+p1} | Blocks release: {n}
- By dimension: {dimension: count, ...}

## 🚀 Safe to fix now ({n}) ← omit when empty

> Single obvious fix, low risk, no product decisions. Can be applied in one batch.

- **#{n}** `[{issue_type}]` {summary} (`file:line`)

## Needs your input ← need_more_context only, omit when empty

- [ ] {summary} — missing: {missing}

## 📣 Workflow feedback ({n}) ← omit when empty

> Observations from this run's subagents about the review workflow itself. Not action items — use them to decide whether to update the skill files.

- **Suggestion**: {suggestion}
  **Why**: {why}
  **Sources**: {code-style, verify}
```
