---
id_prefix: logic
verify: true
skip_when: docs/lockfile-only diff
---

# Business Logic

Does the change do what the requirement asked, and does it hold up under real inputs? This dimension owns logic correctness (the classic bug hunt) plus design-level judgment: best-practice violations and self-inflicted complexity.

## Quick checklist

- Edge cases: empty arrays/strings, zero, boundary indexes, first/last page, single-item collections
- Null/undefined flowing into code that assumes presence
- Race conditions: concurrent mutations, stale closures, un-awaited promises whose order matters
- Error handling: failure paths that leave state half-mutated or the UI stuck
- State machines: unreachable/unhandled states after this change
- Requirement deviation: the diff contradicts the stated need or acceptance criteria in the PR/issue/conversation
- Bug fixes ship a regression test covering the fixed scenario; new services / store actions / utilities have test coverage; new database Model/Repository ships a sibling `__tests__/<name>.test.ts` incl. user isolation (see `.agents/skills/testing/`)
- Framework misuse: fighting Next.js/React/Drizzle instead of using the documented mechanism (check official docs before assuming custom code is needed)
- Self-inflicted complexity ("没苦硬吃"): hand-rolling what the framework, an existing dep, or a simpler design gives for free

## Rule sources (deep mode: read before reviewing)

- The requirement background in the review prompt's scope summary — the primary yardstick for requirement deviation
- `.agents/skills/testing/SKILL.md` — what needs tests and how they are structured here
- Framework docs when the diff leans on framework behavior (`node_modules/next/dist/docs/` for Next.js — this repo pins a version with breaking changes; do not trust training data)

## How to check

1. Read the diff line by line with side effects in mind; for each changed function ask "what input breaks this?"
2. Trace each error path to its end state: user feedback, state rollback, log.
3. Compare behavior against the scope summary; deviations are findings even when the code is internally correct.
4. For fixes: `ls` the sibling `__tests__/` and check the fixed scenario is actually covered, not just any test touched.

## Violations

- A concrete input/state sequence produces a wrong result, crash, stuck UI, or half-committed state.
- The change silently narrows/broadens behavior versus the requirement.
- A bug fix without a test that would have caught the original bug.
- Custom machinery duplicating a documented framework feature (cite the doc).

## Not violations

- Hypothetical inputs the system cannot produce (verify against callers before reporting).
- Missing tests for trivial glue code with no logic.
- Simple implementations of simple needs — do not demand defensive programming for states upstream code already guarantees. The existing codebase keeps e.g. optimistic updates deliberately simple; match that bar instead of demanding exhaustive edge handling (calibration principle).
