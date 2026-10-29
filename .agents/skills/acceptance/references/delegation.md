# Delegation and context ownership

The coordinator reads this contract once and sends each worker only its role,
relevant constraints, and assigned inputs. Do not invoke the whole acceptance
skill again inside every worker. Reuse valid completed evidence without starting
an execution worker or checker merely to publish it.

## Roles and models

| Role | Owns | Model |
| --- | --- | --- |
| Primary / coordinator | User intent, scope, supplied code changes, product decisions, code repairs, execution/publication gates, final handoff | Existing builder model; routine verification leaves this context |
| Acceptance runner | Project preflight, draft plan, fixtures, product execution, capture, report assembly, authorized publication, cleanup | Explicitly selected lighter general-purpose model with the required tools |
| Acceptance checker | First-round plan review and verdict-bearing evidence inspection | Explicitly selected lighter model capable of the planned media |

Prefer scripts for schema checks, file inventory, coverage counts, and deterministic
capture sequences. Do not create another agent for routine formatting or every case.
For a genuinely separate task, use the least capable model that can complete it:
text-only bookkeeping can use a small model; visual judgment needs image tools,
and temporal claims need the relevant sequence, not just still-image capability.

Use the host's supported model and context controls. In Claude Code, explicitly
set the Agent model, such as `sonnet` for execution/visual review or `haiku` for
bounded text work when available. In Codex, start with `fork_turns: "none"` and
an available lighter model, such as `gpt-6-luna`. These are examples, not assumed
cross-host APIs. Record the actual selection; a label saying "cheap" or an
inherited model is not a selection. If selection is unavailable, disclose it.
Escalate a specific ambiguous finding with its minimal supporting facts instead
of moving the whole run to the strongest model.

The runner learns unknown CLI syntax from the relevant subcommand help once,
reusing the acquired capability record by CLI version. Prefer CLI schemas,
examples and non-publishing validation over loading command manuals. The
primary and checker do not independently discover the same CLI commands.

Reuse each role's agent ID for later stages. A replacement receives its existing
handoff, acquired facts, inspection records, and remaining work; it does not
repeat completed discovery or cases. If agents are unavailable, keep a bounded
execution context and the same ownership discipline; do not claim independent review.

## Acquire once, then hand off

Keep one compact source index alongside the task's existing plan/review files.
For each source or section record its identity, revision or state, acquisition
owner, relevant facts/instructions, and artifact or report location. Use exact
paths plus a revision/digest for files, and target/scope plus observed state for
runtime results. This is a handoff note, not a second report schema.

| Input | Acquisition or inspection owner | What other roles receive |
| --- | --- | --- |
| Original requirement and task-specific diff | Primary, reusing its existing implementation context | Relevant original quotes, explicit file list, prepared diff, base/tested revisions |
| Project adapter, process, living logs, chosen surface, auth, runtime probes | Runner, unless already acquired in the task | Applicable rules and facts with source/version; no repeat setup or source reads |
| Report/plan schema and publication instructions | Runner | Result paths, stable IDs, validation outcomes, coverage and returned links |
| First-round plan and original verdict-bearing artifacts | Checker | Case-specific findings, inspected paths/intervals and provenance |
| New or changed artifacts after corrections or in later rounds | One designated capable inspector | The new inspection record and affected case IDs |

Send acquired content when another role needs it; a path by itself is not reuse
if it makes every role re-open the same source. Assign any missing acquisition
to one owner. Load only an unacquired section or newly needed reference. Do not
repeat `git diff`, repository searches, CLI help, auth preflight, adapter reads,
checklist reads, whole report reads, or screenshot inspection to "confirm" an
unchanged fact. The primary consumes findings rather than reopening worker inputs.

A changed revision, build, fixture, browser state, credential/scope configuration,
or explicit freshness requirement invalidates the affected facts. Record the
reason and acquire only that new state. Refreshing UI refs after navigation or
HMR is new runtime information; rereading a static guide after each click is not.
Never reuse a stale build identity or an old success after a failed operation.

Give each verdict-bearing artifact one inspection owner. In a first round the
checker opens the original final media; the runner captures/indexes it and leaves
visual conclusions provisional. Navigation-only probes are separate from final
evidence. If navigation needs visual interpretation, send that probe to its
assigned inspector instead of having multiple roles open it. Reuse its recorded
findings when that same artifact supports several cases. Inspection must still
cover every claimed state/interval; no missing image or video review becomes a pass.

Keep secrets out of handoffs and reports. Share the auth mechanism/status or
credential handle, not credential values. Ownership does not authorize new
production writes, unrelated cleanup, destructive operations, or scope changes.

## Handoff and reporting

The primary sends a compact packet containing:

- Goal, relevant original requirements, scope, supplied IDs and exact checkout.
- Explicit changed-file list, prepared diff, base/tested revisions, and what
  existing evidence already covers. Do not send the full conversation or code history.
- Acquired project rules, runtime/auth/language facts, source index and their
  validity; assigned unacquired sections and selected surface references.
- Round/plan/report locations, owned resources, write boundaries, model and
  proportional context/tool/time budget, and the next gate to report at.
- Applicable acceptance constraints: user-judged outcomes only; real product
  evidence; every declared evidence type inspected and present before `pass`;
  required comparisons/chapters; immutable published rounds; truthful provenance,
  report language, publication recovery, and final URL/coverage handoff.

Workers save full results in existing plan/report/review artifacts. Return a
brief stage summary: completed/remaining case IDs, findings or blocker, acquired
or invalidated facts, artifact/report paths, and the decision needed next.
Do not paste full DOM trees, logs, schemas, diffs, case tables, or image payloads
into the primary. Return the relevant excerpt only when a finding needs explanation.

The runner returns at environment/plan readiness, completed capture/report, and
publication/cleanup. The checker returns bounded plan feedback and its final
evidence findings. These stage reports replace per-click and per-case approval.
Budget thresholds trigger a compact checkpoint and an explicit continuation
decision; they never silently drop required checks or mark uninspected evidence pass.

## Runner contract

Operate only in the assigned checkout and authorized environment. Acquire missing
project sections and chosen-surface instructions once; apply the retained rules.
Run or reuse preflight before authoring text so auth and report language are known.
Do not change the selected backend, start duplicate services, or alter code to
make acceptance easier. Environment experiments are bounded; report an unresolved
prerequisite with the facts already acquired instead of starting a discovery loop.

Use the supplied requirement/diff to draft or copy the plan. Wait for the primary's
plan-gate signal before product cases; a frozen plan keeps its exact IDs. Execute
deterministic action/capture sequences in batches, branching on actual failures.
Store raw logs, network results and captures in the round and return compact outcomes.
Keep the resource guard and teardown required by the project/surface. Only this
runner mutates its browser, fixtures and owned services; checker reads artifacts.

Assemble the existing report schema, with media-dependent results provisional until
the assigned inspection arrives. Apply case-specific findings without reopening
unaffected inputs. Code repair belongs to the primary; re-run only its affected
cases on the supplied repaired revision. Save new captures separately and preserve
unaffected evidence's original provenance. A missing required artifact or inspection
holds the handoff incomplete even if the execution command succeeded.

Publish only after the primary resolves findings and sends the publication gate.
Use the assigned authored or operation-plan path; preserve supplied subject/operation
IDs. In local mode the gate releases a render instead of an ingest. Return the actual
CLI result, warnings, uploaded or rendered coverage, acceptance URL or report URL and
recovery metadata. Apply quota recovery rather than blind retries. Close only this
run's sessions/services/guard and record cleanup and any resource-blocked cases.
Do not publish merely because the report file exists or a worker budget expired.

The primary assesses these reports against the agreed criteria and known
limitations; it may rely on explicit, attributable inspection records without
repeating the work. An unsupported worker conclusion is a gap to resolve with
its owner, not proof of acceptance.
