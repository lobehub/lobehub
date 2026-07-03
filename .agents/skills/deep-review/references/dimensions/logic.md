---
id_prefix: logic
verify: true
skip_when: docs/lockfile-only diff
---

# Logic Correctness

Does the change do what the requirement asked, and does it hold up under real inputs? The classic bug hunt, plus the tests that pin the behavior down. Design-level judgment (framework misuse, self-inflicted complexity) lives in the business-logic dimension.

## Quick checklist

- Edge cases: empty arrays/strings, zero, boundary indexes, first/last page, single-item collections
- Null/undefined flowing into code that assumes presence
- Race conditions: concurrent mutations, stale closures, un-awaited promises whose order matters
- Error handling: failure paths that leave state half-mutated or the UI stuck
- State machines: unreachable/unhandled states after this change
- Requirement deviation: the diff contradicts the stated need or acceptance criteria in the PR/issue/conversation
- Bug fixes ship a regression test covering the fixed scenario; new services / store actions / utilities have test coverage; new database Model/Repository ships a sibling `__tests__/<name>.test.ts` incl. user isolation (see `.agents/skills/testing/`)

## Rule sources (deep mode: read before reviewing)

- The requirement background in the review prompt's scope summary — the primary yardstick for requirement deviation
- `.agents/skills/testing/SKILL.md` — what needs tests and how they are structured here

## How to check

1. Read the diff line by line with side effects in mind; for each changed function ask "what input breaks this?"
2. Trace each error path to its end state: user feedback, state rollback, log.
3. Compare behavior against the scope summary; deviations are findings even when the code is internally correct.
4. For fixes: `ls` the sibling `__tests__/` and check the fixed scenario is actually covered, not just any test touched.

## Violations

- A concrete input/state sequence produces a wrong result, crash, stuck UI, or half-committed state.
- The change silently narrows/broadens behavior versus the requirement.
- A bug fix without a test that would have caught the original bug.

## Not violations

- Hypothetical inputs the system cannot produce (verify against callers before reporting).
- Missing tests for trivial glue code with no logic.
- Simple implementations of simple needs — do not demand defensive programming for states upstream code already guarantees. The existing codebase keeps e.g. optimistic updates deliberately simple; match that bar instead of demanding exhaustive edge handling (calibration principle).
