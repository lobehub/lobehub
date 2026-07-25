# Final Report Template

This file is deep mode's **output contract** and overrides any environment-default review format. Render the full report; never compress the result into a plain findings list. Write the report in the conversation's language — the structure below is the contract, the wording translates.

Only `verdict: confirmed` findings are rendered (plus unverified dimensions — see below). Order: severity p0 → p1 → p2; within a severity bucket, group by dimension in table order from `SKILL.md`; within a dimension keep reviewer order.

## Rendering rules

- **Structure is mandatory**: title, header metadata, TL;DR, Findings, Statistics always render — even with zero confirmed findings (then Findings states "no confirmed findings" and Statistics still shows the counts).
- **Two questions decide a finding's fate, and both render**: _did this change introduce it_ (`nature` / `exposure`) and _how likely is it to fire_ (`likelihood`). Severity alone never decides whether something blocks the merge — see the scope and de-escalation rules below.
- **Nature line**: `nature: "introduced"` → omit the line (default). `nature: "exposed_legacy"` → render `**Nature**: legacy surfaced by this change (triggered by this diff)` or `... (bystander find)` per `exposure`.
- **Likelihood line** renders on every confirmed finding: `**Likelihood**: high | medium | low`. Never omit — together with severity it is what tells the user whether a finding is worth another fix round. For `low`, append the precondition chain from `scenario` in parentheses.
- **Scope rule — legacy findings do not get fixed in this PR.** `nature: "exposed_legacy"` findings never render `Fix options` and never appear in `Safe to fix now`; they render under `Hand off to owner` with a Linear issue draft instead (see below). The only exception: `exposure: "triggered"` P0 — this diff is what makes the old bug fire, so it renders as a normal finding in the severity buckets **and** blocks merge. Everything else legacy is somebody else's task, and pulling it into this PR is exactly the scope creep this rule exists to prevent.
- **Low-likelihood de-escalation**: a confirmed finding with `likelihood: "low"` and `blocks_release: false` renders at its verified severity but never enters `Merge verdict` prerequisites — it goes to `Follow-ups`. If the user says this is a repeat review of the same PR (second round or later), render `low` + non-blocking findings as one line each under `More P2` regardless of their severity, prefixed `[low likelihood]`. Rationale: after a couple of fix rounds the marginal value of chasing rare edges is below the churn and regression risk it creates; say so in the TL;DR rather than silently dropping them.
- **Issue type** renders the finding's `issue_type` verbatim — never the dimension name.
- **Blocks release** renders verify's `blocks_release` (`yes`/`no`) on every confirmed finding — this is the user's ship/no-ship signal; never omit. Same-root merged entries take the value belonging to the highest merged severity.
- **Existing implementations** line only for `reuse-architecture` dedup findings, listing all entries.
- **Rule source** line renders the finding's `rule_source` when present.
- Apply `fix_options_override` / `nature_override` / `exposure_override` / `likelihood_override` before rendering.
- **Same-root merge**: findings with `same_root_as: X` fold into X's entry — no separate number; add `**Same root**: id (location, issue_type), ...` at the entry's end; entry severity upgrades to the highest among merged; statistics count merged entries once.
- **P2 cap (noise control)**: if confirmed P2 count > 6, render the top 6 fully and collapse the rest into one line each under `More P2`: `**#n** [issue_type] summary (file:line)`. Rank `low` likelihood last when choosing which 6 to render fully.
- **Hand off to owner**: every `exposed_legacy` finding except triggered-P0 renders here. Do NOT create the Linear issues — render the draft and let the user decide; a deep review can surface several legacy items and auto-filing them is noisy and duplicates existing issues. The culprit comes from verify's `culprit` field (the verifier already had the file open) — render it verbatim; `culprit: null` renders "attribution unclear" and no suggested assignee. Do not re-run `git blame` in the render phase.
- Empty severity buckets omit their heading entirely.
- **Release checks**: the `release_checks` array (release-risk only) renders under `Pre-deploy checklist`, outside the severity buckets and excluded from all finding statistics. These are unverified by design — they are questions about production state, not claims about the code. Never merge them into findings, and never let one become a merge-verdict prerequisite; `blocks_deploy: true` items render first and are called out in the verdict's `Basis` line as a deploy-time condition, not a code blocker.
- **Unverified dimensions**: `workflow` findings render under `Process`, `skill-freshness` under `Skill updates` — outside the severity buckets, excluded from P0/P1/P2 statistics. These findings use the same JSON schema as everything else; render one line each mapped from those fields: fact = `summary`, evidence = `location` (plus `scenario` when present), suggested action = the first `fix_options` entry. Their `severity` is advisory and never rendered.
- **Missing sources**: if any reviewer returned `missing_sources`, append a note recommending the listed rule files be fixed/restored.
- **Workflow feedback**: merge equivalent suggestions across subagents, accumulate sources (`sources: code-style, verify`), render at the end; omit the section when empty.
- **PR mode** (the user's message contains a GitHub PR URL): render `Merge verdict` between TL;DR and Findings. Otherwise omit the section entirely. Bare `#123` / `pr 123` do NOT trigger PR mode.

### Merge verdict decision table (PR mode; main agent fills, never delegated)

First match wins:

| Condition                                  | Verdict          |
| ------------------------------------------ | ---------------- |
| `isDraft: true`                            | do not merge yet |
| `mergeable: "CONFLICTING"`                 | do not merge yet |
| any check `conclusion: "FAILURE"`          | do not merge yet |
| in-scope P0 confirmed > 0                  | fix before merge |
| in-scope P1 confirmed > 0                  | fix before merge |
| otherwise (P2 only / out-of-scope / clean) | good to merge    |

**In-scope** = `nature: "introduced"`, **or** `nature: "exposed_legacy"` with `exposure: "triggered"` and severity P0. Everything else — bystander legacy at any severity, and triggered legacy below P0 — is **out of scope for this PR**: it never becomes a prerequisite, it goes to `Hand off to owner`. Rationale: our diff should be judged on what it changed. An old bug we merely walked past does not become our obligation because we happened to review nearby code, and treating it as one is how a focused PR turns into a week of unrelated fixes.

Additional de-escalation: an in-scope finding with `likelihood: "low"` and `blocks_release: false` does not count toward the P0/P1 prerequisite counts either — list it under `Follow-ups`.

Fallbacks: `mergeable: "UNKNOWN"` → treat as mergeable; all checks in progress/queued → CI pending, not blocking; no checks configured → CI pass. "fix before merge" lists the in-scope P0/P1 numbers + one-line summaries as prerequisites; "good to merge" lists P2s and de-escalated findings as follow-ups. When the verdict is "good to merge" but `Hand off to owner` is non-empty, say so in one clause — it is good to merge _and_ it left N items for other owners.

## Pre-send self-check

Before sending, confirm every item; fix and re-render if any is missing:

- Title + header metadata (scope / background / execution mode with pruned dimensions)
- TL;DR present; Findings present (or explicit "no confirmed findings"); Statistics present
- Every confirmed finding **rendered in a severity bucket** has: issue type, location, blocks release, **likelihood**, core problem, evidence, fix cost, fix options, needs test. Findings under `Hand off to owner` are checked by the next item instead — the scope rule forbids their fix options, so requiring them here would make the two rules unsatisfiable together
- Every `exposed_legacy` finding is either a triggered P0 in the severity buckets, or an entry under `Hand off to owner` — never both, never fixed inline, never in `Safe to fix now`
- `release_checks` rendered as a checklist under `Pre-deploy checklist`, never counted as findings, never a merge prerequisite
- No out-of-scope or low-likelihood-non-blocking finding appears in `Merge verdict` prerequisites
- Merge verdict only in PR mode

---

```markdown
# Deep Review Report

**Scope**: {e.g. `feat/user-batch-delete` vs local `main`, 8 files +240/-37, incl. submodule lobehub}
**Background**: {1-2 sentence core of the step-0 scope summary}
**Execution**: {N} dimension reviewers ({list}) + {M} verifiers; pruned: {dimension — one-line reason, or "none"}

## TL;DR

{1-2 sentences: X confirmed (P0 a / P1 b / P2 c), of which Y must be fixed in this PR and Z handed to other owners; the single biggest risk; one suggested next action. On a repeat review, state how many low-likelihood findings were de-escalated rather than re-litigated.}

> Only findings related to this change are kept. Two labels drive the triage: **Nature** says whether this change introduced the problem or merely walked past old code, and **Likelihood** says how often the scenario actually fires. Pre-existing problems are listed under "Hand off to owner" instead of being fixed here — that is deliberate scope control, not an oversight.

📣 {N} workflow feedback item(s) at the end of this report ← only when workflow_feedback is non-empty

## Merge verdict ← PR mode only

**Verdict**: {good to merge | fix before merge | do not merge yet}
**Basis**: in-scope P0 {x} / P1 {y} / P2 {z} confirmed | CI {pass|fail|pending} | draft {yes|no} | mergeable {ok|conflicting} | out-of-scope handed off {h} | pre-deploy checks {c} ({d} blocking deploy)
**Prerequisites**: #{n} {summary} ← "fix before merge" only; in-scope, non-de-escalated findings only
**Follow-ups**: #{n} {summary} ← P2s + low-likelihood de-escalations

---

## 📌 Findings

### 🔴 P0 ({n})

#### 1. {summary}

- **Issue type**: {issue_type}
- **Location**: `src/api/user.ts:87`
- **Blocks release**: yes
- **Likelihood**: {high | medium | low}{ — precondition chain, for low only}
- **Nature**: legacy surfaced by this change (triggered by this diff) ← exposed_legacy only
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

**More P2** ← only when P2 > 6, or on a repeat review for de-escalated low-likelihood findings

- **#{n}** [{issue_type}] {summary} ({file:line})
- **#{n}** `[low likelihood]` [{issue_type}] {summary} ({file:line}) ← repeat-review de-escalation

---

## 🤝 Hand off to owner ({n}) ← exposed_legacy findings not fixed in this PR, omit when empty

> Pre-existing problems, not introduced by this change. Not fixed here on purpose — fixing them would expand this PR's scope. Confirm and I'll file the issues.

- **#{n}** `[{severity}]` `[{likelihood}]` {summary}
  - **Location**: `file:line`
  - **Culprit**: `{commit}` (@{author}, {date}) ← verify's `culprit`; "attribution unclear" when null
  - **Nature**: {triggered by this diff, but below P0 | bystander find}
  - **Issue draft**: {title} — {one-line description + impact}
  - **Suggested assignee**: @{author} ← omit when attribution is unclear

---

## ✅ Pre-deploy checklist ({n}) ← release_checks, omit when empty

> Not defects — things this change depends on that cannot be confirmed from the code. Check them before deploying.

- [ ] **{item}** ← `blocks_deploy: true` items first, marked ⚠️
      {why}

---

## 🔁 Process ← workflow dimension findings, omit when empty

- {summary} — {location}{; scenario when present}; suggested: {fix_options[0]}

## 📚 Skill updates ← skill-freshness findings, omit when empty

- {location: stale skill file:line or proposed skill} — {summary}; suggested: {fix_options[0]}

## Statistics

- Confirmed: {n} ({k} legacy-surfaced) | False positives: {fp} (incl. {os} over-scrutiny) | Need more context: {nc}
- Must-fix this round: {in-scope p0+p1} | Blocks release: {n} | Handed off: {h} | Deferred as low-likelihood: {l}
- Likelihood: high {a} / medium {b} / low {c}
- By dimension: {dimension: count, ...}

## 🚀 Safe to fix now ({n}) ← omit when empty

> Single obvious fix, low risk, no product decisions. Can be applied in one batch. Introduced-by-this-change findings only — legacy code is never auto-fixed here.

- **#{n}** `[{issue_type}]` {summary} (`file:line`)

## Needs your input ← need_more_context only, omit when empty

- [ ] {summary} — missing: {missing}

## 📣 Workflow feedback ({n}) ← omit when empty

> Observations from this run's subagents about the review workflow itself. Not action items — use them to decide whether to update the skill files.

- **Suggestion**: {suggestion}
  **Why**: {why}
  **Sources**: {code-style, verify}
```
