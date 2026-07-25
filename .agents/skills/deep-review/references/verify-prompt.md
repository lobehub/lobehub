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
4. Validate the `nature` field against the actual location: `+` line → should be `introduced`; context/old line → should be `exposed_legacy`. Fix mislabels with `nature_override`.
5. **Validate `exposure` on every `exposed_legacy` finding** — this decides whether the finding blocks this PR or is handed to the code's owner, so treat an inflated label as seriously as a false positive. `triggered` requires a concrete before/after argument: name what this diff changed (new caller, new input shape, new config, widened path) that makes the old problem reachable or harmful when it previously was not. Cannot produce that argument → it is a `bystander`; set `exposure_override: "bystander"`. Bystander finds survive only as obvious p0 production bugs; anything less → `false_positive` with reason starting `out-of-scope legacy:`.
   Then, for every `exposed_legacy` finding you `confirm`, **attribute the culprit while you already have the file open**: `git log -L <start>,<end>:<file>` or `git blame -L <start>,<end> <file>` on the finding's location; return commit + author + date in `culprit`. Attribution that fails or is ambiguous (bulk move, formatting commit, vendored code) returns `culprit: null` — never guess an author. The main agent renders what you return; it will not re-run blame.
6. **Validate `likelihood`** against the real production path, not the theoretical one: who can reach this code, what state/timing/permission is required, what upstream validation already blocks it. `low` means a hand-crafted input, a state the product cannot currently produce, an improbable race, an environment we don't ship, or a guarantee that already holds upstream. Reviewers were told to over-report and tend to inflate this — downgrade with `likelihood_override` whenever the preconditions you actually read are narrower than the finding claims. Consistency: `likelihood: "low"` and `blocks_release: true` can coexist only when the impact is catastrophic and irreversible (data corruption, financial loss, auth bypass); otherwise a `low` finding is `blocks_release: false`.
7. **Over-scrutiny filter** (skip for findings from dimension files marked `calibration_exempt: true`): if the finding holds the diff to a standard the surrounding codebase itself does not meet — the flagged pattern is widespread in equivalent existing code and this diff does not make it worse — verdict `false_positive` with reason starting `over-scrutiny:`. Same verdict for lifespan mismatch: the finding demands configurability, extensibility, or expiry automation from code the scope summary / PR / comments declare temporary (time-boxed campaign, experiment, one-off script) — reason starting `over-scrutiny: lifespan`; the only temporary-code findings that survive are those whose damage persists beyond the window (billing/credit/data writes). This filter exists because reviewers were instructed to over-report; you are the noise gate.
8. **Extra steps for `dimension: release-risk` findings**, which claim a release consequence rather than a code defect — verify the consequence, not the code:
   - *Data-layer*: read the actual migration/schema statement and confirm the claimed irreversibility. Additive and reversible (nullable column, new table, concurrent index) → `false_positive` unless a stated rollback/ordering hazard survives. For a `jsonb` shape claim, open the reader and confirm it really does not defend against the legacy shape.
   - *Dev-cycle churn*: read the PR's migrations as a series and confirm the same PR both creates and later reworks the object. An object the PR only alters (it existed on trunk before) is a normal forward migration → `false_positive`. Same for a "code reads an uncreated table" claim: grep the schema files yourself before confirming.
   - *Prompt surface*: the finding must name a **behavioral** delta, not a stylistic one — which instruction was removed/weakened, or which tool's selection behavior moves and in which direction. A finding that only says the prompt changed, or that argues the new wording is worse writing, is `false_positive`. For a "removed instruction" claim, check the text really is gone rather than moved elsewhere in the assembled prompt. Confirmed prompt findings are never `can_auto_fix: true` — rewording a prompt back is a behavior decision, not a batch edit.
   - *High-frequency UI*: confirm two things independently — that the surface really is on the first-minute path (name it), and that an **established** behavior changed rather than something being added. Additive-only, or a surface reached through several deliberate steps → `false_positive`. A finding that merely restates that the change is user-visible, or that argues the new design is worse, is `false_positive` with reason starting `out-of-scope: ux`.
   - *Shared surface*: the finding must carry a call-site count — reproduce it (grep the imports). No measurable blast radius, or the contract is unchanged for existing callers → `false_positive`.
   - *PR purity*: confirm independence yourself — check that nothing outside the proposed split imports what it adds, and that the split-out part would build and deploy alone. Cannot prove independence, or the "sub-requirements" share a dependency → `false_positive`. Splitting is expensive; only a provable, worthwhile split survives.
9. **Extra steps for `dimension: reuse-architecture` dedup findings**: open EVERY file in `existing_implementations` (≥ 30 lines context each) and compare behavioral equivalence — same input → same output/side effects. At least one true equivalent → `confirmed`; all merely syntactically similar → `false_positive` naming the semantic difference; unable to tell without missing context → `need_more_context`.

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

`release-risk` findings are always `can_auto_fix: false` — a PR split, a migration rollout plan, or a base-component contract change is a release decision for the human, never a batch edit.

`nature: "exposed_legacy"` is always `can_auto_fix: false` (`auto_fix_reason: "legacy code — not this PR's scope"`), regardless of how trivial the fix looks. Patching someone else's old code from an unrelated PR is a scope decision for the human, never an auto-applied batch edit.

## blocks_release (confirmed only)

Would shipping without this fix be unacceptable? `true`: production incident / data corruption / security hole / auth bypass, or breaks acceptance criteria or a main user path. `false`: real but shippable — rare edges, degraded-but-working flows, internal/bookkeeping, code quality.

Consistency: p0 → must be `true`; p2 → must be `false`; p1 → your call. A `likelihood: "low"` finding is `false` unless the impact is catastrophic and irreversible.

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
      "exposure_override": null,    // only when the original exposure is mislabeled; triggered | bystander
      "likelihood_override": null,  // only when the original likelihood is inflated or understated; high | medium | low
      "culprit": null,              // confirmed exposed_legacy only: "<short sha> <author> <YYYY-MM-DD>", or null when attribution is ambiguous
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
