# Phase 1 plan feedback

Use this template at the end of Phase 1 (see [`../PROCESS.md`](../PROCESS.md)). Match the user's conversation language.
Keep it concrete and compact: report observed state, not generic readiness claims.

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

## Confirmation behavior

For the first run attached to a subject Acceptance, use the runtime structured
question tool (`request_user_input` / ask-user-question equivalent) after the
feedback. Do not bury the question inside the template text.

When the verdict is **Ready** or **Ready with warnings**, use:

1. `Start (Recommended)` — approve the displayed environment and plan; enter Execute.
2. `Discuss first` — revise scope, cases, assumptions, or environment handling.

When the verdict is **Blocked**, do not offer Start. Use:

1. `I'll provide it (Recommended)` — the user will supply or complete the listed
   user-owned prerequisite.
2. `Revise the plan` — change the scope or approach to remove the blocker.

Match button labels to the user's language. Wait for the user's response. If the
user resolves a blocker, re-check the affected environment item and present an
updated gate; do not rely only on the user's statement that it is fixed.

### Follow-up rounds

The first approved plan authorizes later repair-and-reverify iterations on the
same subject Acceptance. For a follow-up triggered by user feedback or an
iteration request:

- read `lh acceptance view <subject> --json`;
- silently re-check environment and auth;
- repair and re-run the affected stable check ids;
- publish a new immutable round to the same Acceptance automatically;
- do not ask the user to approve another routine plan.

Present a new confirmation gate only when scope, business goal, evidence surface,
external authority, destructiveness, or a user-owned prerequisite materially
changes. A code revision, local server restart, fixture update, screenshot
recapture, retry, or automatic follow-up publication does not reset approval.
