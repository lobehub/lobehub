# User-journey flows

Before authoring checks, identify the independently reviewable user tasks in the
requirement. Use those tasks as business groups, not the PR title or test surface.
For example, reassignment, scheduled continuation, and failure recovery can be
separate groups when the delivery covers all three; do not impose these groups
on unrelated work. Each check should have an outcome the user can accept or
reject independently. Keep shared entry/accessibility checks separate and avoid
repeating their expectations across business checks.

When acceptance depends on a sequence of user states, publish its graph during
planning, before implementation or verification begins. Keep independent checks
on their checklist path — authored checks in [report.md](report.md), or the
frozen operation plan in [plan-format.md](plan-format.md) — alongside any flow.
A graph is optional and does not replace that checklist, evidence or human review.

For flow-based plans, **each flow's title is its checks' default checklist category**.
Publish independent user journeys as separate flows in the same acceptance/run;
use subflows for actual composed journeys. An umbrella flow containing checks
for several independent tasks collapses them into one checklist group. Edges
must describe real user transitions, not artificial links added to make unrelated
checks reachable. Start at the user entry and follow the journey through outcomes
and recovery; UUIDs identify nodes and must not encode business order. Read back
the published plan and inspect its groups and reading order before execution.

For an existing acceptance that only needs different checklist groups, use
`lh acceptance regroup <acceptanceId> --file groups.json`. Read the acceptance
bundle first; write `{ expectedVersion, groups: [{ title, checkItemIds }] }`,
using the exact union `checks[].id` values and
`acceptance.metadata.checkGrouping.version` (0 when absent). The groups replace
the current presentation grouping; an empty list restores plan categories.
Unassigned checks keep their plan category. This preserves check IDs, numbering,
evidence and review history without creating a round. It does not change flow
transitions or verification conditions. Do not move execution nodes or start a
new round just to reorganize the checklist; those operations have different
execution semantics.

1. Use the named acceptance, or create one before publishing the flow. If none
   was named, first run `lh acceptance create --help` and confirm it shows
   `Usage: lh acceptance create [options]` and `--requirement`. Parent-command
   help or a zero exit code alone does not prove support. If unavailable, upgrade
   `@lobehub/cli` to a release that supports this command and check again;
   updating the skill alone does not upgrade the CLI. If still unavailable,
   report flow-first creation as blocked. Do not invent a subject ID, upload an
   empty report, or substitute `lh acceptance run create` (which creates a round).

   `--requirement` is a required, nonblank durable business goal; `--title` is
   optional. Omit `--subject` for a fresh standalone subject, even when an ambient
   topic exists. Pass `--subject task:<id>`, `topic:<id>`, `document:<id>`, or
   `standalone:<id>` only for an explicitly supplied subject. Reusing a subject
   preserves its recorded requirement, title, and state; it does not reopen it.
   Creation does not create a verification round, report, results, or passing verdict.

   The JSON contains `acceptanceId`, `acceptanceUrl`, `requirement`, `status`,
   and `subject: { subjectType, subjectId }`. Use `acceptanceId` in all flow
   commands below, **not** `subject.subjectId` or a verification run ID. Share
   `acceptanceUrl` verbatim; it already uses the CLI's configured server.

   Write a JSON file with `definition: { title, entryNodeId, nodes, edges }`.
   Give nodes and edges stable UUIDs. Each node has `id` and exactly one of
   `criterionId` (existing check asset), `check: { id, title, definition }`
   (a check asset with steps, fixtures, preconditions and expected outcome), or
   `subFlowId` (another flow in this acceptance). Edges have `id`, `sourceNodeId`,
   `targetNodeId`, `trigger`, `required`, and optional `condition`. Every node must
   be reachable from the entry. Publish child flows before referencing them.
2. `lh acceptance flow publish <acceptanceId> --file flow.json` saves the
   definition and returns `flowId`. To edit it, include that `flowId` and the
   current `expectedHash` in the file. `lh acceptance flow view <acceptanceId>`
   reads definitions, snapshots and results. Publishing does not execute checks.
   Revise a graph in place rather than publishing a second one; a superseded
   graph left behind still renders as its own journey with its own unexecuted
   checks. `lh acceptance flow delete <acceptanceId> --flow <flowId>` removes
   one that never should have existed, and only while it has no verified
   history: it is refused once a settled round has run it, or while another
   flow invokes it as a subflow.
3. `lh acceptance flow plan <acceptanceId> --flow <flowId>` creates a draft round
   with the graph and its plan. While the round is only planned it follows the
   live graph: publishing an edit refreshes its snapshot and plan in place, and
   running `flow plan` again refreshes the same draft instead of opening another
   round. Add `--run <verifyRunId>` to attach another flow to the same draft. Read `lh acceptance run get <verifyRunId> --json` for
   the actual plan IDs: each branch and subflow invocation has its own
   `checkItemId`; never substitute the reusable asset ID.
4. Share the acceptance link so the user can inspect the proposed nodes, branches
   and expected outcomes before implementation. Read and address any actionable
   feedback. Preparing a plan neither executes checks nor approves delivery;
   there is no separate flow-confirmation action. Continue within the user's
   authorized scope, or pause if the user explicitly asked to review before work.
   For requested changes, publish the revised definition with its `flowId` and
   `expectedHash`; the draft round follows automatically. Never open another
   round or another flow just to revise a plan that has not executed.
5. Implement the work and exercise the real product, then use
   `lh acceptance flow record <acceptanceId> --file result.json`, containing
   `verifyRunId`, `checkItemId`, `verdict` (`passed`, `failed`, `uncertain`, or
   `blocked`) and `observation`. Record only what was observed. Use the returned
   result ID to attach required artifacts through `lh acceptance run evidence`
   (inspect its `--help`), following the same evidence rules as checklist checks.
6. After all required checks are recorded and passed, run
   `lh acceptance flow complete <acceptanceId> --run <verifyRunId>`. Completion
   settles verification; it does not accept the delivery on the user's behalf.
   Read back the round and verify evidence coverage before handing it over.

To rerun the exact old graph, prepare a plan with `--from-run <sourceVerifyRunId>` and
omit `--run` for a fresh round. This preserves the old definition and starts
without results. Each replay starts as an unexecuted draft. A round is frozen
by its first recorded result; only then does it keep its number. An
`lh acceptance run ingest` that reaches an acceptance whose latest round is
still a draft folds into that draft rather than opening a new round. Accepted or closed
acceptances must be explicitly reopened
before starting. Edges describe business transitions; they do not automatically
schedule execution. Continue to read `lh acceptance feedback <acceptanceId> --actionable` before repairs and publish new rounds into the same acceptance.

