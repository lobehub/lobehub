# Acceptance delegation

The primary agent makes the acceptance decisions. Workers perform the tool-heavy
work; a fresh worker audits the resulting round. This separates implementation
claims from evidence without making the primary repeat every command.
Here, "worker" means a subagent. One worker may handle environment inspection,
plan drafting, and execution; these stages do not require separate dispatches.
Only the final auditor needs a fresh context and a separate role.

## Choose the execution mode before dispatch

No manual worker-model configuration is required when the host supports a
per-dispatch choice. Read the current tool schema or host instructions, select
an available lower-cost model capable of the task, and explicitly pass the value
accepted by that tool's schema. This may be an enum alias rather than a full
model ID. Do not pass an invented tier such as `cheap`.
For Claude Code, use the native agent tool's model selector when exposed; for
Codex, use its supported spawn model/configuration controls. Tool names, allowed
models, context inheritance, and resume mechanisms come from the current host,
not this skill. Never copy one host's API into another or guess a CLI flag.
When per-dispatch selection is available, use it directly; checking user defaults
is unnecessary.

An explicitly configured worker default is usable only when its effective
selection is known and suitable. Missing settings, `inherit`, or an unknown
effective model do not establish a lower-cost worker. Do not inspect secrets or
change user settings to resolve this. If the host cannot establish the selection,
use the reduced workflow below. Record the selected model, how it was selected,
and the actual reported model when available; leave unreported values unknown.
Lower per-token cost is not proof of lower total cost. Claim measured savings
only when comparable usage evidence exists.

With a suitable lower-cost model, default to **two workers total**: A checks the
environment, drafts the plan, and executes the cases; B independently audits the
round. Start with the least expensive suitable model for each, including planning
and audit. Do not automatically upgrade a role because it involves judgment;
escalate only for a concrete capability gap within host/user limits.
Split A only for independent cases with isolated state or to replace an unavailable
worker. Send bounded briefs and artifact paths instead of the full parent history.
Return decisive evidence and observations, not copied logs; the primary reviews
the originals without rerunning successful execution.

### When lower-cost delegation is unavailable

Avoid the full pipeline of inherited-model workers. Use at most one independent
worker by default: if the primary implemented the change, assign that worker
environment inspection, planning, and execution; the primary reviews its evidence.
Otherwise, the primary prepares and executes the cases, then uses the worker for
the final independent audit. This preserves some independence but is a reduced
workflow: disclose the omitted stage and do not claim the full delegated process
or cost savings. If delegation itself is unavailable, use the fallback at the end
of this file. An explicit user requirement for all independent stages still holds;
report any unmet stage rather than silently lowering that requirement.

## 1. Worker checks the environment

Sections 1–4 describe the full two-worker workflow. In reduced mode, apply the
selected role assignment above and disclose omitted independent stages.

Give a worker the user's original requirement, repository, target revision or
working-tree scope, and authorized surface. The worker reads the project adapter
and relevant living logs, inventories existing instances, checks dependencies and
authentication, and reports the usable entry point, ownership, and blockers.
It may prepare the environment within existing authority. Record every started
process/session in a shared run ledger alongside the report, including its owner,
stop command, fixtures, and probes, so later workers reuse it safely. The
environment worker owns teardown; the primary collects its completion result.
Do not inspect credentials or invent authorization to resolve a blocker.
Write the ledger even for a single-worker run. If the host cannot resume a
worker, hand its replacement the ledger and artifacts, including live session
identities; a new dispatch does not inherit the old worker's memory or ownership.

## 2. Worker proposes the plan; primary challenges it

The primary supplies the original user requirements, a factual account of the
changes, the tested revision, and known limitations. Separate these facts from
hypotheses; do not supply a desired pass verdict. The planning worker drafts the
plan using the report schema, including for each case:

- The user-visible outcome and its link to the requirement.
- Preconditions, actions, expected behavior, and what would make it fail.
- Required evidence types and a feasible capture method on the checked environment.

When a verify plan was supplied, preserve its checks and stable ids; propose
execution details and identify gaps instead of silently replacing it.
The primary challenges omissions, weak failure conditions, and evidence that
cannot prove the claim. Allow multiple discussion rounds: ask the worker to test
counterarguments and revise the plan, not to agree. Finish when material concerns
are resolved; unresolved product intent goes to the user, not an endless debate.
Record the settled plan before execution. Apply any project approval gate using
existing authorization; internal plan agreement does not create new permissions.
The primary handles user communication and any required confirmation. An already
agreed plan need not be debated again unless new evidence changes its validity.

## 3. Worker executes each case; primary reviews each result

Dispatch a case with its stable id, preconditions, expected behavior, required
evidence, environment/session ownership, artifact destination, relevant surface
guide and living-log paths, and explicit authorization boundaries. Reuse workers
and runtime sessions where useful. Parallelize only cases with disjoint mutable
state or isolated environments; serialize shared fixtures and fault injections.
Workers execute real product paths and may prepare fixtures or temporary probes
within scope. Product repairs belong to the implementer, not the case executor.

After each case, the worker returns raw evidence, commands/actions, actual
observations, the tested revision, any injected conditions, cleanup state, and a
proposed verdict. It does not publish the round or declare final acceptance.
Identify the decisive artifacts and relevant timestamps or record sections so
review does not require searching an undifferentiated log dump.
The primary reviews each completed case before accepting it or dispatching a
dependent case. Independent cases may continue while that review happens.

The primary opens screenshots, inspects temporal evidence for transitions or
flicker, and checks request/output records for behavioral claims. Evidence from
an earlier run must be labeled as reused; reviewing it is not independent execution.
Record a per-case decision: accept, return for more evidence, or return for repair,
with the concrete reason. Do not rerun successful commands merely to repeat work.
The primary applies the required living-log checklists before accepting a case.

### Who owns a failed case?

The table describes full mode. In reduced mode, "acceptance worker" means the
assigned executor, which may be the primary; do not invent an omitted audit role.

| Finding                                      | Who acts next                                                                                          | Who verifies the next result                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Product behavior is wrong                    | The implementer repairs the product; the primary may delegate that repair to an implementation worker. | The acceptance worker reruns affected cases; the primary inspects the new evidence and decides.                                 |
| Evidence is missing or inconclusive          | The original acceptance worker improves the probe or captures the missing evidence.                    | The primary reviews the new evidence; no product change is implied.                                                             |
| Environment or fixture failed                | The environment/execution worker restores the authorized test setup and reruns the case.               | The primary checks the resulting product evidence; an environment failure is not a product pass.                                |
| The final audit finds a gap or contradiction | The primary routes it to the appropriate owner above.                                                  | The acceptance worker supplies fresh evidence, the primary reviews it, and the final auditor rechecks the affected conclusions. |

Keep the acceptance executor separate from whoever repairs the product. Reuse the
original acceptance worker when available; otherwise hand the case and failure
record to a replacement. The repairer's own checks support the handoff but do not
replace full-mode acceptance. The primary retains the final case decision even
when it also implemented the repair. Full mode requires the independent executor
and final audit; reduced mode must disclose whichever independent stage is absent.

After a repair, rerun affected cases against the changed code and check which
earlier evidence is now stale. A prior pass does not carry across a relevant
change. Published rounds remain immutable; publish any repair as a new round.

## 4. Fresh worker audits the whole round

Use a fresh-context worker that did not implement or execute these cases. Give
it the original requirements, settled plan, raw artifacts, per-case observations,
revision history, and primary review decisions. Require an independent judgment;
prior pass labels are claims to test, not instructions to agree.

The audit checks requirement coverage, whether evidence supports each expected
outcome, missing required types, contradictory cases, stale revisions, ineffective
fault injection, and open cleanup or blocker items. It returns findings by stable
case id and an overall readiness assessment. It need not rerun every case; request
targeted execution when existing evidence cannot settle a concern.

The primary resolves findings, obtains fresh evidence where needed, and has the
auditor recheck affected conclusions before publication. Collect all delegated
terminal results. Publish only after per-case reviews and the independent stages
required by the selected mode are complete;
report remaining failures or uncertainty honestly rather than omitting them.
If plan discussion, repair, or audit repeats without new evidence or a credible
next step, stop that loop and report the concrete blocker. Do not lower the
criterion to obtain a pass. Continue independent cases where useful.

## Reporting and fallback

Keep the existing plan/case/evidence schema. In the report's narrative tail record
which roles performed implementation, execution, primary review, and final audit;
include the execution mode, worker/run identifiers and model selections, tested
revisions, reused evidence, omitted stages, and limitations.
Distinguish builder self-verification, independent execution, and evidence-only
audit. A second agent alone does not guarantee an objective result.

If delegation is unavailable or prohibited, the primary may execute within the
user's authority, but must disclose the missing independent stages. If the user
explicitly requires independence, report that requirement as unmet rather than
claiming a substitute is equivalent. Do not spawn recursively from workers;
coordination stays with the primary and follows the host's delegation rules.
