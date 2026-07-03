# Verify Subagent Prompt Template

Verification is the anti-hallucination backbone: review agents deliberately over-report; the verify agent independently falsifies each candidate. Review and verify must never share an agent — their goals are opposite, and one agent doing both collapses into confirmation bias.

Verification is pipelined per dimension (or per Codex group): as soon as a review subagent returns findings, spawn its verify subagent — do not wait for other reviewers. Dimensions whose file says `verify: false` (workflow, skill-freshness) skip verification entirely.

How to instantiate:

1. `{issues}` → the JSON array of that reviewer's findings (wrap in a ` ```json ` fence), keeping original ids
2. `{scope_summary}` → the same scope summary from step 0
3. `{changes}` → the same diff text or fetch command(s) the reviewer received

---

`````text
Verify the following code-review findings. Do not fix anything — judge only.

## Scope summary
{scope_summary}

## Changes (needed to judge `+` lines)
Diff text or fetch command(s) — check the head, run commands yourself if needed:

{changes}

## Findings to verify (process each id independently)
{issues}

## Verification actions (execute fully for EVERY finding)

1. Open the finding's `location` file and read ≥ 30 lines of context on each side.
2. Chase the relevant call chain, type definitions, and existing tests.
3. Check whether the described scenario actually triggers.
4. Validate the `nature` field against the actual location: `+` line → should be `introduced`; context/old line → should be `exposed_legacy` AND genuinely triggered/exposed/depended on by this diff (if merely a bystander find, keep only obvious p0s, otherwise `false_positive`). Fix mislabels with `nature_override`.
5. **Over-scrutiny filter** (skip for findings from dimension files marked `calibration_exempt: true`): if the finding holds the diff to a standard the surrounding codebase itself does not meet — the flagged pattern is widespread in equivalent existing code and this diff does not make it worse — verdict `false_positive` with reason starting `over-scrutiny:`. Same verdict for lifespan mismatch: the finding demands configurability, extensibility, or expiry automation from code the scope summary / PR / comments declare temporary (time-boxed campaign, experiment, one-off script) — reason starting `over-scrutiny: lifespan`; the only temporary-code findings that survive are those whose damage persists beyond the window (billing/credit/data writes). This filter exists because reviewers were instructed to over-report; you are the noise gate.
6. **Extra steps for `dimension: reuse-architecture` dedup findings**: open EVERY file in `existing_implementations` (≥ 30 lines context each) and compare behavioral equivalence — same input → same output/side effects. At least one true equivalent → `confirmed`; all merely syntactically similar → `false_positive` naming the semantic difference; unable to tell without missing context → `need_more_context`.

## Anti-shortcut red lines

- Every finding gets the full procedure; no shared conclusions across findings, even in the same file.
- No "skim all files once, then batch-label".
- Verdicts must not infect each other (A false_positive says nothing about B).

Violating any red line invalidates the verification. Slow is acceptable; shortcuts are not.

## Stance: falsify by default

Look for the counterexample first: existing validation, early return, upstream guarantee, framework behavior, type constraint that prevents the scenario. Found one → `false_positive`. `confirmed` requires evidence you actually read (file:line or snippet), not "sounds plausible". If you are about to confirm an entire batch, stop and ask whether you are rubber-stamping. A `false_positive` is high-value output, not an insult to the reviewer.

Keep it pragmatic: `reason` is one sentence; `evidence` is file:line + the shortest necessary argument (do not restate summary/scenario). Unsure → `need_more_context`, never a guessed `confirmed`. `fix_options_override` only when clearly better (found a reusable util, original option introduces a new bug, misses a necessary edge).

## can_auto_fix (confirmed only)

The main agent lists `can_auto_fix: true` findings in the "safe to fix now" batch. You judge it — you read the files. ALL four must hold:

1. `fix_cost: low`
2. Single obvious fix — one option, or several that are equivalent implementation details (no product/architecture trade-off)
3. No external resource or product decision needed (no third-party setup, env values, threshold choices, fail-open vs fail-closed calls)
4. Small blast radius — none of: 3+ files changed, architecture-layer changes (service split/merge, router restructure, store slice shape, core hook/context signature), database schema/migration, external contracts (API params, webhook payloads, third-party calls), user-perceivable behavior (UI flows, routes, hotkeys, end-user copy, permission boundaries)

Any miss → `can_auto_fix: false` with `auto_fix_reason` naming the failed criterion. `reuse-architecture` findings default to `false` (caller migration violates #4); the rare exception (constant swap, single import switch, no signature change) needs its justification in `auto_fix_reason`.

## blocks_release (confirmed only)

Would shipping without this fix be unacceptable? `true`: production incident / data corruption / security hole / auth bypass, or breaks acceptance criteria or a main user path. `false`: real but shippable — rare edges, degraded-but-working flows, internal/bookkeeping, code quality.

Consistency: p0 → must be `true`; p2 → must be `false`; p1 → your call.

## same_root_as (dedup, confirmed only)

Multiple reviewers (or dimensions) often report the same underlying problem from different angles, or a set of findings one fix would resolve together. Process findings in input order; the first occurrence of a root cause returns normally; subsequent same-root findings add `same_root_as: <first id>`. "One fix resolves both" is the test — same location not required. Their `evidence` may be shorthand (`same root as style-1`).

## Return format (strict JSON)

One JSON object in a ```` ```json ```` fence. Valid JSON only.

{
  "verifications": [
    {
      "id": "logic-1",              // must match an input id exactly
      "verdict": "confirmed",       // confirmed | false_positive | need_more_context
      "evidence": "src/api/user.ts:87 — upstream zod schema lacks min(1); empty array reaches SQL",  // confirmed only
      "can_auto_fix": true,         // confirmed only
      "auto_fix_reason": null,      // only when can_auto_fix=false: which criterion failed
      "blocks_release": true,       // confirmed only
      "nature_override": null,      // only when the original nature is mislabeled
      "same_root_as": null,         // optional; first-occurrence id of the shared root
      "fix_options_override": null, // optional; string array, only when clearly better
      "note": null,                 // optional caveat/risk remark

      "reason": null,               // false_positive only: one sentence why it does not hold
      "missing": null               // need_more_context only: what context is missing
    }
  ],
  "workflow_feedback": [            // optional; omit when empty
    { "suggestion": "...", "why": "..." }
  ]
}

### Completeness (hard constraint)
`verifications` must contain exactly one entry per input finding, ids matching one-to-one — no omissions, no inventions, no merging. A missing id means the task is incomplete; the main agent will reject the result and re-run verification for missing ids.
`````
