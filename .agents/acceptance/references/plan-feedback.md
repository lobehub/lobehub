# Phase 1 plan feedback

Use this template at the end of Phase 1 (see [`../PROCESS.md`](../PROCESS.md)). It
is written into the round's review notes and handed to the acceptance-checker for plan
review — not posted to the user for approval. Match the user's conversation
language. Keep it concrete and compact: report observed state, not generic
readiness claims.

## Readiness verdicts

- **✅ Ready**: every prerequisite for the proposed run is verified.
- **⚠️ Ready with warnings**: execution can proceed; list non-blocking limitations
  and their effect on evidence or scope.
- **❌ Blocked**: execution cannot start until one or more prerequisites are
  resolved.
- **⏳ Pending**: an agent-owned check is actively being resolved and has not
  reached a final readiness verdict yet.

Always prefix the overall verdict and every Status cell with its emoji marker:
`✅ Ready`, `⚠️ Warning`, `❌ Blocked`, or `⏳ Pending`. Do not use color words or
bare status text without the marker; the table must remain scannable in clients
that do not render semantic colors.

Fix safe environment mechanics yourself before reporting. Separate remaining items
by owner:

- **Agent-owned**: dependencies, processes, ports, generated local env, seeded
  fixtures, navigation, retries, and other work possible within the task's scope.
- **User-owned**: secrets the user must supply, device/2FA approval, permissions
  only the user can grant, destructive authorization, or an unresolved product
  choice that materially changes the plan.

Never put an agent-owned item under "Needed from you." If none remain, write `None`
explicitly.

## Template

```markdown
Verification plan — Environment: <✅ Ready | ⚠️ Ready with warnings | ❌ Blocked>

Environment

| Check              | Status                                      | Observed state                                      |
| ------------------ | ------------------------------------------- | --------------------------------------------------- |
| Workspace / branch | <✅ Ready/⚠️ Warning/❌ Blocked/⏳ Pending> | <path, branch/worktree, relevant dirty-state note>  |
| Dependencies       | <✅ Ready/⚠️ Warning/❌ Blocked/⏳ Pending> | <root and selected standalone app status>           |
| Runtime / ports    | <✅ Ready/⚠️ Warning/❌ Blocked/⏳ Pending> | <resolved URLs/ports and ownership or availability> |
| Required services  | <✅ Ready/⚠️ Warning/❌ Blocked/⏳ Pending> | <DB, cache, queue, dev server—only those in scope>  |
| Auth               | <✅ Ready/⚠️ Warning/❌ Blocked/⏳ Pending> | <selected surface and verified signed-in state>     |
| Evidence capture   | <✅ Ready/⚠️ Warning/❌ Blocked/⏳ Pending> | <CDP or OS capture readiness>                       |

Execution plan

1. <Surface and entry point>
2. <Case 1: behavior → expected result → evidence>
3. <Case 2: behavior → expected result → evidence>
4. <Report and publication deliverable>

Scope and assumptions

- In scope: <what this run proves>
- Out of scope: <intentional exclusions, or None>
- Assumptions / warnings: <items that may affect interpretation, or None>

Needed before execution

- Agent will resolve: <remaining non-blocking or in-progress agent-owned work, or None>
- Needed from you: <exact user-owned prerequisite and why it is required, or None>
```

Do not include irrelevant environment rows. Add a row when the run has another hard
prerequisite, such as a native app, gateway, fixture repository, or specific
external account.

## What a planned case may be

The skill's HARD RULE decides this, and the gate must not propose a case that
will never reach the page: every case is a delivery outcome a person judges, and
the repo's own programmatic gates (tests, coverage, type-check, lint, build) are
never cases — ingest drops them and a gates-only round fails to publish. Run them
as diligence and report them as one line of narrative.

Seed a follow-up plan from `lh acceptance view <subject> --json`, not from
memory: omit accepted checks, repair non-stale rejects under their exact stable
ids, and carry every `supersedes` chain forward unchanged. For every user-visible
UI case, plan the screenshot or recording that proves that exact claim — program
output may supplement visual evidence but never replaces it.

## Gate behavior

The acceptance-checker is the gate, in the first round only. Plan/case feedback
is capped at two responses total; the second is optional and checks revisions.
The primary resolves remaining findings itself without requesting a third response.
Hand the feedback plus the
draft plan to the acceptance-checker (skill `references/acceptance-checker.md`); on **✅ Ready** / **⚠️ Ready with
warnings** and an acceptance-checker decision of "ready" (or every material finding
resolved), enter Execute. The acceptance-checker returns once more for the first round's
evidence review before publishing, and not again after that. Never ask the
user to approve the plan, and never present `Start` / `Discuss first` style
buttons for a routine run.

When the verdict is **❌ Blocked** on a **user-owned** item, ask the user one
structured question naming exactly that prerequisite and why it is required,
then stop. If the user resolves it, re-check the affected environment item; do
not rely only on the user's statement that it is fixed. Agent-owned blockers
are never sent to the user.

### Follow-up rounds

For a follow-up triggered by user feedback or an iteration request:

- read `lh acceptance view <subject> --json`;
- silently re-check environment and auth;
- repair and re-run the affected stable check ids;
- publish a new immutable round to the same Acceptance automatically (no
  acceptance-checker re-review — the acceptance-checker takes part in the first round only);
- do not ask the user to approve the follow-up plan.

The only reasons to ask the user in a follow-up are a user-owned prerequisite
(a secret, a device/2FA approval, a permission only they can grant, a
destructive action) or a product decision that materially changes the plan —
scope, business goal, evidence surface, or external authority. A code
revision, local server restart, fixture update, screenshot recapture, retry,
or automatic follow-up publication is never a reason to ask.
