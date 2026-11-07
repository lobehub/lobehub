# Goal Commands

Long-horizon Goal Graphs: a Goal owns a requirement, a graph of
`task` / `finding` / `decision` / `problem` / `experiment` nodes, and one
supervising agent that plans between bounded turns. Task workers execute and
register deliverables through the normal lifecycle; the planning agent only
plans.

**Source**: `apps/cli/src/commands/goal.ts`

## The planning loop

Every planning turn is handed a block with a `token` and the current
`LOBEHUB_OPERATION_ID`. Three CLI calls are involved:

1. `lh goal show <id> --json` (or `lh goal state <id>`) — read the evidence.
2. Write a JSON plan file.
3. `lh goal plan <id> --token <turn token> --file <plan.json> --json` — submit
   one atomic plan and exit.

`plan` picks its endpoint from the credential: an operation-bound token (device,
gateway, sandbox) goes to `submitOperationPlan`, a user login to `submitPlan`.

A refusal is a **verdict about the turn, not a transport blip** — do not retry
the same token. On refusal the CLI now prints the server's own admission to
stderr (so `--json` stdout stays parseable) before the error propagates; `lh goal state <id>` reproduces that answer on demand.

## Reading state

### `lh goal state <id>` (alias `inspect`)

`[--events <n>] [--json [fields]]`

The one call that answers "why can this Goal not move?". It renders:

- the Goal's status, `pausedBy`, subject carrier and agent
- the **planning turn**: token, operation and its run status, `consumed`,
  `failedTurns`, `dispatchNeverStarted`, `problem`
- **snapshot / review**: the receipt hash the turn was pinned to next to what the
  server computes now — the only place a "stale plan" becomes visible, because
  these hashes are server-owned
- **Admission**: whether a plan for this turn would be accepted, and if not, the
  server's `code` (`stale_input`, `consumed`, `turn_settled`, `inactive`,
  `pending_decision`, `budget_exhausted`, …) plus a one-line reading of it
- the queue (unfinished tasks, pending decisions) and the newest events

### `lh goal events <id>`

`[-L, --limit <n>] [--cursor <token>] [--entity <type>] [--type <type>] [--json]`

The audit trail, newest first. `--entity` filters
`goal | node | edge | decision | task`; `--type` filters
`created | updated | activated | resolved | rejected | retired | linked | unlinked`.
`show`/`graph` embed only the newest 200 events; this command pages the whole log.

Paging is by cursor, not offset: events are prepended while a goal runs, so an
offset would re-serve a row a later insert pushed down. When a page is full the
command prints the cursor to continue with (`--cursor "<iso>|<id>"`).

### `lh goal show <id>` / `lh goal graph <id>`

The graph snapshot: the header carries status, `pausedBy`, subject carrier and a
planning-turn line; then a table of nodes with their incoming relations.
`--json` returns the full snapshot including `decisions`, `events`, `spend`,
`acceptances` and `runHeartbeats`.

### `lh goal list`

`[--agent <id>] [--project <id>] [--status <s>...] [--limit <n>]`

Roll-up per Goal: task progress, findings, `NEEDS YOU` (pending decisions), cost.

### `lh goal decisions <id>` / `supervision <id>`

Durable decision gates; and recovery incidents with the effective recovery rate.

## Submitting a plan

### `lh goal plan <id>`

`--token <turn token> --file <plan.json> [--operation <id>] [--json]`

The file is one of:

```json
{ "action": "tasks", "reason": "...", "tasks": [{ "title": "...", "description": "...", "dependsOn": ["<task node ID>", 0] }] }
{ "action": "verify", "reason": "..." }
{ "action": "wait", "reason": "...", "until": "<future UTC ISO>", "event": { "type": "external.result", "key": "<job id>" } }
{ "action": "retry", "taskId": "<failed task>", "failedOperationId": "<latest failure>", "reason": "..." }
{ "action": "escalate", "reason": "...", "ask": { "question": "...", "options": [{ "id": "waive", "label": "...", "description": "...", "effect": "retry" }], "recommendedOptionId": "waive" } }
```

`dependsOn` accepts a task node ID from an earlier round or the 0-based index of
an earlier task in the same plan. A later round without these links looks
unrelated to the evidence it uses.

A `tasks` plan may declare a batch with `rollout` when the work applies one
recipe to many units (migrate N stores, cache N resources, update N callers):

```json
{
  "action": "tasks",
  "reason": "...",
  "rollout": {
    "recipe": "<procedure every unit follows>",
    "units": ["<unit>", { "title": "<unit>", "description": "<its own pointers>" }],
    "variants": [{ "axis": "...", "values": ["...", "..."] }]
  },
  "tasks": [{ "title": "<probe unit>", "description": "<full brief>" }]
}
```

`tasks` then hold 2-5 representative probes; `units` list every other unit. The
probes run first, the rest are released wave by wave once the probes ran through
without a person, and a rejection revises the recipe and re-probes. Whether the
units are one mould is the planning agent's call; the server refuses only a
malformed declaration, a Goal with `--rollout off`, or a batch already in flight.
No planning turn starts while a batch is in flight, except one: when the probes
settle, the main Agent gets a `rollout_distill` turn to rewrite the plan from
what they ran into — answer it with `revise_plan` and the full plan — and the
gate judges the probes after that.

`wait` is how a turn waits for time or external evidence — never sleep or poll.
Producers deliver the event with `lh goal wake`.

### `lh goal wake <id>`

`--token <managerState.token> --event <id> --type <type> --key <key> [--summary] [--reference]`

Delivers an external result to a specific wait. A wake asks the planner to
reconsider evidence; it never proves success.

### `lh goal report <id>`

`--metadata-file <path> --content-file <path> [--operation <id>]`

Submits the wrap-up report from the Goal's wrap-up run.

## Lifecycle, budget and routing

| Command                               | Effect                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `lh goal create <title>`              | Create a goal and seed its graph (`--topic`: a draft; `--task-model` + `--task-provider` pick the task model) |
| `lh goal start <id>`                  | Start a draft (`--rollout` folds its seed tasks into a batch)                                                 |
| `lh goal pause <id>` / `resume <id>`  | Stop / restart coordination (`--confirm-exit` settles a paused turn)                                          |
| `lh goal restart <id>`                | Reset every unfinished task to backlog                                                                        |
| `lh goal delete <id>`                 | Delete the goal and its graph (`--yes`)                                                                       |
| `lh goal tick <id>`                   | Advance exactly one coordinator step                                                                          |
| `lh goal run <id>`                    | Tick until a stop condition                                                                                   |
| `lh goal set-budget <id>`             | Rounds / cost / experiments / turns / concurrency / attempts                                                  |
| `lh goal set-agent <id> <agent>`      | Hand supervision to another agent                                                                             |
| `lh goal set-task-agent <id> <agent>` | Route tasks to a dedicated executor (`none` hands them back)                                                  |
| `lh goal set-model <id>`              | Planning model: `--model <id> --provider <id>`, `--model none` clears                                         |
| `lh goal set-task-model <id>`         | Model of every task (unfinished ones switch); `--model none` clears                                           |
| `lh goal bind-topic <id>`             | Supervise from the current topic run                                                                          |

`create --topic` links a Goal to the conversation it was created from and
returns a `turnToken` for the first plan; without it the Goal is standalone and
never shows on that topic's goal tray.

From a chat, `create --topic` opens the Goal as a **draft**: nothing is
dispatched until it is started. Arrange it first — seed tasks with `-t` or
`--task-file` (titles with descriptions and a `dependsOn` list of other titles
in the file, drawn as `depends_on` edges), adjust with `add-node` / `add-edge` /
`remove-edge` — then launch it with `lh goal start <id>`; the owner can also start it from the
goal page. Many tasks of one recipe start as a batch:
`lh goal start <id> --rollout canary --recipe-file <md> --probes <2-5 node ids>`
moves the probes into a batch and turns every other seed (or only `--units`)
into roster units released wave by wave behind the gate. Inside a batch a seed
may depend only on a probe, and every folded seed needs its own title; start
refuses anything else. Once started with tasks in place, the creating turn is
settled: `lh goal plan` on its token is refused, and later work comes from the
next planning turn.

## Decision gates and graph editing

| Command                                             | Effect                                           |
| --------------------------------------------------- | ------------------------------------------------ |
| `lh goal decide <id> <decision-id> --option <id>`   | Resolve a durable decision gate                  |
| `lh goal retire <id> <node-ids...>`                 | Retire nodes that must not run                   |
| `lh goal add-node <id> <kind> <title>`              | Add a node (`--scope`, `--question`, `-d`, `-p`) |
| `lh goal add-edge <id> <source> <target> <kind>`    | Connect two nodes                                |
| `lh goal remove-edge <id> <source> <target> [kind]` | Remove edges from a draft (`--reason`)           |

An edge reads `<source> <kind> <target>`: `A depends_on B` means A waits for B.
`A blocks B` is accepted by `add-edge` and `remove-edge` and stored as
`B depends_on A`, which is how `lh goal show` prints it. Only a draft can lose
edges; a started Goal retires nodes instead. `lh goal show` / `list --json` carry
the goal page `url`.
