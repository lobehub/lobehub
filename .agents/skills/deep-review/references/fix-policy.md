# Fix Policy

Deep mode fixes first and asks second. A review that ends in a pile of questions costs the user a
round-trip for every finding; most confirmed findings have one obvious fix and the reviewer already
verified the evidence. The main agent applies those directly and reserves questions for the few
findings where a wrong guess is expensive.

Only **in-scope** confirmed findings enter this policy: `nature: "introduced"`, or
`nature: "exposed_legacy"` with `exposure: "triggered"` at P0. Every other legacy finding goes to
`Hand off to owner` and is never fixed here.

## Decision table

First match wins.

| Finding                                               | Action                                                 |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `need_more_context`                                   | `Needs your input`                                     |
| P0 / P1 that is **high-risk** (see below)             | `Needs decision` — ask before touching it              |
| P0 / P1, everything else                              | **fix now**                                            |
| P2 that is **quick** (see below)                      | **fix now**                                            |
| P2, everything else                                   | `Follow-ups` — ask only if the user wants them done    |
| low likelihood and `blocks_release: false`, any level | `Follow-ups` (same de-escalation as the merge verdict) |

`can_auto_fix` from the verifier is an input, not the decision: a `can_auto_fix: false` P1 is still
fixed now unless it is high-risk. The verifier's `auto_fix_reason` is the first place to look when
deciding whether the finding is high-risk.

## High-risk P0 / P1 — needs a discussion

A P0/P1 is high-risk when any of these hold. Then the wrong fix is worse than a short wait, so ask.

- The `fix_options` are materially different product or design directions (reposition vs. remove
  vs. redesign), not one fix with variants.
- The fix changes an external contract: a wire/API response shape, a persisted payload, a database
  schema or migration, an event name, a public package API, or anything released clients depend on.
- The fix changes a permission or trust boundary, an auth path, or who can perform a destructive
  action.
- The fix deletes or rewrites persisted data, or causes an irreversible outbound effect.
- The fix requires knowledge the repo cannot give: production state, a rollout window, an owner's
  intent, a paired release in another repo.
- `fix_cost` is high, or the fix would touch more than one architecture layer in a way the reviewer
  did not spell out.

A finding that merely _touches_ a sensitive file is not high-risk by itself: adding the same
permission guard the sibling endpoints already use is a normal P1 fix, choosing which permission
model a new endpoint should have is a discussion.

## Quick P2

A P2 is quick when all of these hold; then it is cheaper to fix than to ask.

- `fix_cost` is low and there is one obvious fix (the verifier set `can_auto_fix: true`, or the
  first `fix_options` entry is a mechanical change with no alternative worth weighing).
- Fewer than three files change and no product decision, copy decision, or external contract is
  involved.
- It does not require a new test beyond adjusting an existing one, or the test is a one-case
  addition next to an existing suite.

Anything else stays a follow-up. Comment wording, stale docstrings, missing error logging, a
missing `console.error` in a catch, a wrong i18n key, an unused import, an off-by-one in a guard the
tests already cover: quick. A missing loading state, a debounce, a new SWR key, a layout change:
follow-up.

## After fixing

- Run the repo quality check on every changed file and the related test files; a fix that fails
  is reverted or narrowed until the checkout is green, then reported under `Needs decision`.
- Never commit or push as part of the review. Leave the fixes in the working tree and report them;
  the user's commit workflow takes over from there.
- Render `Fixed this round` in the report with one line per finding and the check outcome. If the
  report was already sent before the fixes ran, send the section as a short follow-up message.
