# Swarm Goals — design

Status: design, not built. Builds on Goal marks (`marks.ts`, commit 0f5d9bb672a).

## Why

A Goal today plans a task graph and verifies each Task. That fits building and migrating;
it fits badly when the work is *optimising one score against an evaluator* — tune a model,
raise a benchmark, cut a latency — where progress is "submit, read the score, change,
submit again".

We measured it on EdgeBench (`k12_math_recommendation`, Kimi Code, 2 h wall clock; harness
and raw data in `~/CodeProjects/edgebench-eval`, see its `RESULTS.md`):

| Shape | runs | score @2h (mean) | @30m | output tokens |
|---|---|---|---|---|
| Single Kimi session | 7 | 33.6 (sd 4.5) | — | 133k |
| Today's Goal (planner splits into serial tasks) | 1 | 21.8 | 16.2 | 219k |
| 3 independent sessions, keep the best | 2 | 37.0 | 34.2 | 607k |
| 3 lanes + marks (no coordination) | 1 | 34.7 | 34.2 | 374k |
| 3 lanes + marks + coordinator | 3 | 37.4 | 26.5 | 409k |

What this says:

1. **Parallel lanes scored against an evaluator are the win** (+3.5–4 over one session):
   a single agent's result varies a lot, and keeping the best of several removes the bad
   draws.
2. **Marks plus a coordinator matched best-of-N on score at about two thirds of the
   tokens.** Lanes stopped re-debugging each other's pitfalls and reused what worked. They
   did not raise the score beyond the noise at 2 h.
3. **Serial decomposition is the wrong shape here.** Splitting by component broke the
   submit loop, and per-Task acceptance spent the time budget on evidence.
4. **Uncoordinated sharing collapses diversity.** Lanes copied the leader and ended on
   identical code.
5. **Forcing different approaches from minute 0 costs the early score** (26.5 vs 34.2 at
   30 min), because slow approaches start late.

Swarm mode is the shape that matched those results, built into Goals.

## Scope

A Swarm Goal is an optimisation Goal:

- an **evaluator**: a command that scores the current deliverables;
- an **objective**: maximise or minimise that score;
- a **timebox**: a deadline, or a token / cost budget;
- **N lanes**: parallel copies of the workspace, one long-running Task each.

It is not a replacement for planned Goals. Builds, migrations and anything without a
scoring command keep today's planner. A planner may *propose* swarm mode when the
requirement names a metric and an evaluator.

## Concepts

| Concept | What it is | Built on |
|---|---|---|
| Lane | An independent copy of the workspace, plus the time-boxed Task that works in it | `experiment` container node; per-topic working directory |
| Evaluator | A command run inside a lane that prints a score (plain number, `TOTAL_SCORE n`, or JSON `{score, valid, summary, metrics}`) | new `lh goal evaluate` |
| Objective series | One metric series per Goal; each evaluation is a point tagged with lane, run and code fingerprint | metric series and observations (`metric` router, north-star criteria) |
| Leaderboard | Each lane's best and latest valid score, the leader, time since the last new best | derived from the objective series |
| Directive | A coordinator instruction addressed to one lane | new mark kind `directive` |
| Champion | The best-scoring lane state when the run ends; promoted back to the root workspace | — |

## User flow

```sh
lh goal create "Raise k12 score" \
  --swarm 3 \
  --workspace ~/proj/k12 \
  --evaluator './.eb/submit' \
  --objective max \
  --deadline 2h \
  --task-agent <kimi-or-cc-agent>
```

- The Goal page shows the leaderboard: one row per lane, with its best score, a sparkline,
  and its current direction. Below that come directives and marks, and the champion with
  a "promote" action.
- Each lane run sees the usual `<goal_marks>`. Directives addressed to that lane come
  first, then the leaderboard.
- An agent calls `lh goal evaluate` instead of the raw evaluator. It runs the configured
  command in the lane, records the point, and prints the score and feedback.

## Architecture

### 1. Lanes and workspaces

- Lanes are `experiment` container nodes, one lane Task inside each; `config.swarm` records
  the lanes. This reuses containment, collapse and drill-down in the graph UI.
- **Where a lane runs** decides how it gets its own workspace:
  - **Device**: a plain directory copy, no git worktree. On the lane's first run
    `lh hetero exec` copies the workspace into `<workspace>/.lanes/<lane>` — `cp -c`
    (APFS clone) / `cp --reflink=auto`, falling back to a normal copy — `.git` included, so
    each lane is a self-contained repo that nothing else writes to. The coordinator
    dispatches the lane Task with `initialTopicMetadata.workingDirectory` set to that
    directory; topic metadata already wins over the agent's per-device default
    (`topicWorkingDirectory.ts`), so cwd resolution is unchanged.
  - **Sandbox**: nothing to split. Every lane is its own sandbox started from the same
    workspace source, so isolation comes for free.
- **Sharing between lanes goes through the server, never through another lane's files.**
  Each `lh goal evaluate` uploads the archive of the deliverables it just graded (the
  evaluator's declared paths, small by construction) as a Work version linked to the lane.
  `lh goal lane adopt <lane>` downloads that lane's latest valid archive into the calling
  lane, keeping a local snapshot for rollback. Devices and sandboxes use the same path, and
  the champion is simply the best valid archive.

### 2. Evaluator and objective

`lh goal evaluate [-d]` does the following in order:

1. Takes the lane from the run's operation token. That resolution path is the one marks
   already use: operation → task → goal node, here also → lane container.
2. Runs `config.swarm.evaluator` in the lane directory. Evaluations are serialised per
   device by a lock, because evaluators are often heavy.
3. Parses the score.
4. Uploads the graded deliverables archive as a Work version on the lane (what `lane adopt`
   and the champion read).
5. Writes a metric point on the Goal's objective series:
   - `actorType: agent`, `sourceType: probe`;
   - `metadata: {lane, taskId, operationId, fingerprint, valid, summary}`;
   - `fingerprint` is a hash of the evaluator's declared deliverable paths, or of
     `git diff HEAD` in the lane.
6. Prints the score and feedback to the agent.

The objective is a north-star criterion, so the existing metric gate (#19133) and the
metric UI apply without new storage. The leaderboard is a read model over the series
grouped by `metadata.lane`.

Trust: the evaluator runs in the agent's environment, so a determined agent can forge a
score. That is acceptable for a user's own optimisation work, and the prompt forbids it as
the benchmark prompt did. For anything public, the evaluator can be bound to a sandbox or
remote judge later; the series format does not change.

### 3. Timeboxed lane Tasks

- A lane Task is complete only at the deadline.
- A lane run that ends early is re-dispatched immediately with a continuation brief. It
  goes through no verification and charges no attempt. The benchmark harness did this by
  making acceptance fail before the deadline; this replaces that trick with real
  semantics.
- Lane Tasks carry no per-Task acceptance. The objective is the acceptance.
- At the deadline the coordinator:
  1. stops lane runs (operation cancel);
  2. runs one final evaluation per lane;
  3. picks the champion — the best valid point, tie-broken by recency;
  4. marks the Goal achieved if the objective criterion is met, otherwise `paused` with
     the champion recorded.
- A token or cost budget ends the run the same way when it runs out first. It reuses
  `evaluateBudget`.

### 4. Coordinator policy

The policy is a pure function over the leaderboard, the lane fingerprints and the marks.
It runs in the goal tick every 10 minutes, or on each new point, rate-limited. It was
prototyped as `harness/coordinator.py` in `~/CodeProjects/edgebench-eval`.

| Signal | Condition (defaults) | Action |
|---|---|---|
| Leaderboard | every tick | refresh the single leaderboard mark, which is pinned in prompts |
| Converged | two lanes share a fingerprint | keep one, give the others new directions |
| Stagnant | no new global best for 25 min (scaled to the timebox) | new directions for every lane |
| Lagging | a lane is more than 3 points or 10% behind the leader after 30% of the timebox | adopt the leader, then a direction |
| Warm-up | before the first valid score in any lane | none: lanes start free to get a runnable version fast |

Directions come from one system-model call per decision. Its inputs are the task
requirement, the leaderboard, recent marks and the lanes that need a direction, and it
returns one direction per lane. Each direction is written as a `directive` mark addressed
to its lane. A lane gets at most one live directive; a new one retires the old one, with a
20-minute cooldown.

The warm-up row is the one change from the prototype. The benchmark showed that forcing
diversity at minute 0 cost about 8 points at 30 min. Planned starting approaches become
optional (`--diverse-start`), and diversification starts after the first valid score.

### 5. Marks

The existing marks need no schema change. Score and lane live in the objective series,
and a mark's author lane is its `produces` source inside the lane container. Two additions:

- **Kind `directive`.** It is written only by the coordinator and carries `scopeId` = its
  lane. It ranks first in that lane's `<goal_marks>`, and other lanes do not see it.
- **The leaderboard is a pinned `pattern` written by the coordinator.** It is retired and
  replaced on each tick, so only one is live.

The `signature` column planned for pain detection stays a separate change.

### 6. Cost controls

- The lane count is capped by `maxConcurrentTasks`.
- Per-lane token accounting comes from operations. The leaderboard shows tokens per lane
  next to its score.
- Reclaim: a lagging lane that ignores two directives is stopped and re-forked from the
  champion.
- A Goal-level token budget is an alternative to the deadline. For a fixed budget, swarm
  spends it about a third faster on coordination-free sharing than independent best-of-N
  does.

## Delivery plan

All of it sits behind the Agent Lab gate (`useAgentLabGate`) until the benchmark target
below holds.

| PR | Content | Depends on |
|---|---|---|
| 1 | Goal marks (done, 0f5d9bb672a) | — |
| 2 | `config.objective`, `lh goal set-objective` / `evaluate` / `objective`, objective series with lane metadata, operation-token write path, leaderboard read model, `<goal_objective>` prompt section, per-machine evaluation lock (built) | 1 |
| 3 | `config.swarm`, lane containers, per-lane directory (device) / per-lane sandbox, graded-archive upload and `lane adopt`, timeboxed lane Tasks, deadline wrap-up and champion | 2 |
| 4 | Coordinator policy in tick, `directive` marks, prompt pinning | 3 |
| 5 | Goal page leaderboard and champion promote (web) | 2 (reads), 4 |

Each PR's acceptance includes the EdgeBench harness on `k12_math_recommendation`
(3 lanes, 2 h, Kimi Code). The bar for removing the Lab gate is:

- the score is at least best-of-3 independent sessions (≥ 37.0 mean over 3 runs);
- output tokens are at most 0.75× best-of-3;
- the 30-minute score is no worse than best-of-3, which the warm-up phase must buy back.

## Decisions

Everything defaults to automatic.

- **The planner selects swarm mode on its own** when the requirement names a score or metric
  to push and a command that produces it (an evaluator script, a benchmark, a test that
  prints a number). It infers the evaluator, the direction and the deadline from the
  requirement. The lane count is `min(3, maxConcurrentTasks)` unless the user sets it.
  `--swarm` / `--no-swarm` override the choice.
- **The champion is promoted automatically at wrap-up.** The best valid archive is
  unpacked over the root workspace, after the root's previous state has been kept as a
  snapshot: a Work version, plus `.lanes/_before_promote` on devices. A one-click restore
  undoes the promotion. The Goal report states what was promoted and from which lane.
- **Evaluations queue per machine, not globally.** Each device (or sandbox) evaluates only
  its own lanes, and a per-machine lock keeps heavy evaluators from running at the same
  time on one host. A global limit is needed only when the evaluator calls a shared
  external resource, such as a rate-limited judge API. For that case
  `config.swarm.maxConcurrentEvaluations` (default: unlimited) is enforced by the server
  through a short lease taken by `lh goal evaluate`.
