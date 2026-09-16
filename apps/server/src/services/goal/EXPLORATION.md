# Goal graph exploration (MVP)

Exploration is opt-in. An ordinary Goal still completes its existing task graph;
an exploration Goal evaluates completed experiments and grows that same graph.

```sh
lh goal create 'Compare three candidate explanations' \
  --requirement 'Deliver three independently evaluated explanations and justify the best one.' \
  --explore 'Start with a baseline. Try one alternative, then derive a third candidate from the baseline. Compare the recorded results before requesting final acceptance.' \
  --max-experiments 3 --agent <agent-id>
```

The first Task produces a baseline. Its normal Task settlement creates a finding
and schedules a Goal advance. The Goal model then chooses one of three actions:

- `expand`: choose a resolved historical experiment container and create one experiment.
  `child --derived_from--> parent` records provenance; `depends_on` continues to
  mean execution dependency. The child receives the selected parent's findings
  and pins the parent's produced Work version references as inputs.
- `revise`: rerun one experiment with a corrected protocol when it measured the
  wrong thing — a wrong output shape, metric, threshold or evaluation procedure.
  Without it the only move available is a sibling that inherits the same flawed
  instrument, which reproduces the flaw rather than answering the question.
- `verify`: request the existing independent terminal acceptance Task. The
  planner cannot declare the Goal achieved.

These three are the whole vocabulary, and that bounds what exploration can say: it
can move within the graph, but it cannot express "this goal is mis-framed", "the
judge was wrong" or "stop and ask". Those belong to an optional main Agent, which
`config.manager` adds as a second layer rather than a replacement — exploration
keeps the ordinary path and the main Agent is handed the problem at the moment the
coordinator would otherwise stop the Goal on a person. See `manager.README.md`;
the handover point is `gateOrTakeOver`.

A correction is a Task inside the experiment it corrects, not a new container, so
it does not consume an experiment slot: fixing an instrument should not cost an
exploration budget. `MAX_PROTOCOL_REVISIONS` bounds them per experiment, and
`revisionsRemaining` reports the balance in the planner input so an exhausted
allowance is visible before the choice is made rather than refused after it.
Corrections carry a dedicated `revises` edge rather than `derived_from`: that kind
is generic provenance, is writable through the public `addEdge` mutation, and
already appears on hand-authored tasks, so reusing it would reinterpret unrelated
provenance as a correction. `revises` is written only by the coordinator and is
deliberately absent from the public vocabulary. Rolling this release back leaves
any queued correction dispatchable but weaker: the previous coordinator resolves
provenance through the containing experiment, so the rerun carries that
experiment's branch parent instead of the experiment it corrects, or no history
when the container is a root. The corrected protocol itself is in the Task
description and survives, so the degradation is missing context rather than a
wrong instruction; drain queued corrections before rolling back if that matters.
An experiment reads as unresolved while a correction runs,
so corrections are serial. A seed Task with no experiment container cannot hold
one and reports no allowance; those goals expand first.

Retries remain attempts of the same Task, with their existing TaskTopics. They
do not create new experiment nodes. A bad experimental result may be useful
research evidence; the experiment's own contract should evaluate execution and
measurement, not require it to satisfy the whole Goal.

A five-minute lease in `goals.config.exploration.checkpoint` protects the model
call. PostgreSQL row locks serialize the claim and graph patch; a changed graph,
policy, or paused Goal invalidates a late answer. The patch, parent edge, input
version links and decision event commit together. Existing queued advances and
sweeps provide wakeups; no browser polling or manual tick is needed to continue.

The cap counts experiment containers, including the baseline, excluding final
Goal acceptance. At the cap, insufficient evidence pauses the Goal rather than
marking it achieved. Increase the cap with:

```sh
lh goal set-budget goal_id --max-experiments 6
```

A cap-stopped Goal resumes when the limit is raised; an explicitly user-paused
Goal stays paused. Planner failures pause for explicit resume. Existing cost,
round, deadline and per-Task recovery budgets continue to apply. Planning calls
use the configured Goal system model; existing execution spend accounting does
not include those planning calls.

This MVP supports immediate result feedback and historical text provenance. It
does not restore a historical filesystem, provide isolated experiment sandboxes,
schedule feedback months later, or prove months-long operational continuity.
Work version links preserve references; they do not grant access or restore
artifact contents. No database migration is required.

## Answer containers and scoped graphs

An experiment is a persisted `experiment` node representing one candidate answer
for a `problem` node: `experiment --answers--> problem`. It contains any node
kind through `contains`, including subquestions and nested experiments. Both an
answer and its question live in the same containing scope. Containment has one
parent and cannot cycle; provenance and reasoning remain a separate graph.
The existing text columns accept these kinds without a DDL migration.

Default seeded tasks and normal decomposition create answer containers without
an exploration flag. Opt-in exploration controls automatic generation of later
candidates, not whether experiments exist. A container has no Task binding:
its contained task nodes keep their execution, attempts and deliveries. Findings
and recovery decisions join their task's scope. Container status reflects all
descendant work; pending decisions, empty branches and unanswered subquestions
prevent early completion. Final Goal acceptance remains independent.

The default experimental canvas is one complete compound graph. Experiments start collapsed, retaining historical branches and projected
cross-boundary links; expanded experiments draw containing
boundaries around their internal work, including nested answers. Collapse hides
only that container's descendants and projects cross-boundary semantic edges to
the visible container, marked as internal links. Expanding restores the original
nodes and exact relation endpoints. An explicit group button drills into its internal graph; breadcrumbs return
to ancestors or the overview while retaining expansion choices.
The overview count includes nested experiments regardless of collapse or filters.
An optional inspector retains findings, pinned inputs and historical sources;
Task nodes open their execution records. Fullscreen includes a minimap for pan
and zoom. A 200-experiment regression checks projection/layout, not UI readability
at that scale.

Existing stored Task-only graphs are not rewritten on read. They retain their
Task nodes, and the exploration planner can use an uncontained legacy Task as a
historical parent for a newly created container. A historical-data migration is
outside this MVP. Adding an empty nested answer does not automatically plan its
internal work yet; clients supply that work through scoped add-node calls.

实验图支持两种显式操作：卡片点击原地展开 group，group 的 “下钻” 按钮进入该实验的内部图。内部图可继续展开嵌套实验及下钻，并通过面包屑返回父实验或全局。展开状态在返回时保留，新到达的实验默认收起；当前图的批量收起 / 展开只影响该范围内的实验。空实验下钻保留空态和返回入口。

Navigation breadcrumbs live in the ReactFlow Panel inside the canvas in both embedded and fullscreen views. Historical derived\_from edges are stored child-to-baseline but displayed baseline-to-child as continued exploration. Orthogonal paths use measured card bounds and group headers as obstacles; containment frame interiors remain traversable. Experiment status glyphs use the canonical completed/waiting/backlog visuals rather than defaulting every aggregate state to a live running ring.
