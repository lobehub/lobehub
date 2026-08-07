# Verify Subagent Prompt Template

Verification independently falsifies candidate findings. Review and verify must never share an
agent.

Instantiate:

1. `{issues}` → this reviewer's findings as valid JSON, preserving ids
2. `{scope_summary}` / `{changes}` → the same values the reviewer received
3. `{verification_addenda}` → include
   [`verification/release-risk.md`](verification/release-risk.md) when the payload contains a
   release-risk finding, [`verification/reuse-architecture.md`](verification/reuse-architecture.md)
   when it contains a reuse-architecture finding, both when needed, or `None`

---

````text
Verify the following code-review findings. Do not fix anything.

## Scope summary
{scope_summary}

## Changes
Use the diff directly, or run every fetch command when commands were supplied:

{changes}

## Findings
{issues}

## Dimension-specific verification
{verification_addenda}

## Required procedure for every finding

1. Open the location and read enough surrounding context to understand the function or contract.
2. Chase the relevant callers, types, validation, and tests.
3. Look for the counterexample first: an upstream guarantee, early return, framework behavior, or
   existing validation that prevents the scenario.
4. Validate `nature`: a changed `+` line is normally `introduced`; old code is
   `exposed_legacy`. Use `nature_override` when the reviewer mislabeled it.
5. For `exposed_legacy`, require a concrete before/after trigger. Without one, override exposure to
   `bystander` with `exposure_override`. Bystander findings survive only when they are obvious P0
   production bugs; otherwise return `false_positive` with reason beginning `out-of-scope legacy:`.
6. Attribute confirmed legacy code with `git log -L` or `git blame`. Return commit, author, and date,
   or `null` when attribution is ambiguous.
7. Validate likelihood against the real production path and use `likelihood_override` when needed.
   `low` requires a concrete precondition chain. Low-likelihood findings block release only for
   catastrophic, irreversible impact.
8. Validate severity as impact only. Use `severity_override` when the reviewer's P0/P1/P2 label is
   wrong; judge `blocks_release` against the effective severity after that override.
9. Apply the codebase and lifespan calibration unless the dimension declares
   `calibration_exempt: true`. Widespread and not worsened, or permanent-code standards applied to
   declared temporary code, means `false_positive` with reason beginning `over-scrutiny:`.
10. Apply every supplied dimension-specific addendum.

Process findings independently. Do not batch-label them or let one verdict influence another.
Confirmed verdicts require file-and-line evidence. Uncertainty is `need_more_context`, never a
guessed confirmation.

## can_auto_fix

Set `can_auto_fix: true` only when all are true:

- `fix_cost` is low;
- one obvious fix exists;
- no external resource or product decision is needed; and
- the change touches fewer than three files and no architecture layer, database schema, external
  contract, user-visible behavior, route, hotkey, copy, or permission boundary.

`release-risk` and `exposed_legacy` findings are never auto-fixes.

## blocks_release

- `true`: production incident, data corruption, security/auth failure, or a broken acceptance
  criterion/main user path.
- `false`: shippable rare edge, degraded-but-working behavior, or code-quality/bookkeeping debt.

P0 must block; P2 must not. Low likelihood is non-blocking unless impact is catastrophic and
irreversible.

## Return format

Return exactly one valid JSON object in a `json` fence. No comments, prose, trailing commas, or
invented ids.

Each input id must appear exactly once. Use only fields belonging to the selected verdict:

- `confirmed`: `id`, `verdict`, `evidence`, `can_auto_fix`, `blocks_release`; add
  `auto_fix_reason` when false. Optional corrections use these exact fields:
  `severity_override` (`p0` / `p1` / `p2`), `nature_override` (`introduced` /
  `exposed_legacy`), `exposure_override` (`triggered` / `bystander`), `likelihood_override`
  (`high` / `medium` / `low`), and `fix_options_override` (string array). Add `culprit` or `note`
  when applicable.
- `false_positive`: `id`, `verdict`, `reason`.
- `need_more_context`: `id`, `verdict`, `missing`.

```json
{
  "verifications": [
    {
      "id": "logic-1",
      "verdict": "confirmed",
      "evidence": "src/api/user.ts:87 — the input schema accepts an empty array and the SQL builder receives it",
      "can_auto_fix": true,
      "blocks_release": true
    },
    {
      "id": "style-1",
      "verdict": "false_positive",
      "reason": "over-scrutiny: equivalent files use the same convention and this diff does not worsen it"
    }
  ]
}
```

Optional top-level `workflow_feedback` entries use
`{"suggestion":"...","why":"..."}`.
````
