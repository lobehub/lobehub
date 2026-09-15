# Acceptance checker handoff

The `acceptance-checker` checks plans and evidence in the **first acceptance
round only**. The primary owns preparation, execution, evidence inspection,
repairs, cleanup, and publication. Reuse one checker across both stages when
supported; otherwise give its replacement the same handoff and prior findings.
Never assume a role name or model parameter exists: use the current host's
supported agent controls. Prefer the cheapest model capable of inspecting every
planned artifact, and record the actual selection when known; an inherited
model does not imply lower cost.

The checker replaces routine user plan approval. Ask the user only for a
user-owned prerequisite (a secret, device/2FA approval, a permission only they
can grant, a destructive action) or a
product decision that materially changes the plan.

## Shared contract

Send one compact handoff per response with the stage, inputs, and requested
output below. For code context, the primary supplies an explicit file list,
relevant diff text or prepared diff artifact paths, and base/tested revisions.
The checker must not run `git diff`, search the repository, or expand that
list; return missing context to the primary.

Reference existing plan/report files; do not create a second JSON schema or
duplicate case tables. Keep review notes in the ignored acceptance directory
and summarize them in the existing narrative tail. Save the requirement-to-case
mapping there and include its path in both stages; do not add a report field.

Give every handoff an explicit budget proportional to what it must read (plan
items, artifact count). Diff reading must not displace artifact inspection;
report any inspection limit rather than silently skipping evidence.
Response limits are counted separately by stage and do not reset when the
checker, handoff, or plan changes.

The checker must not start services, change fixtures, run product cases,
repair probes, edit product code, publish, or spawn agents. Return missing or
unreadable artifacts to the primary rather than debugging the environment.

## 1. Plan review

**At most two feedback responses for the plan and cases.** After the initial
response, the primary may request one check of its revisions if needed. The
primary resolves and records remaining findings itself; the limit does not
waive material blockers or require a second response.

Primary input:

- Original requirement/feedback sources and agreed non-goals, separate from
  implementation hypotheses. Use links, local message records, or verbatim
  excerpts with relevant screenshots and scope decisions. Label unavailable
  sources and summaries; never invent a transcript or send the entire
  conversation when focused material is available.
- Code context per the shared contract, plus a plain-language summary of what
  the change does and where it shows up.
- Draft plan using the existing schema, with stable case IDs, requirement mapping,
  preconditions, operations, observable expectations, and evidence requirements.
  Put additional explanation in existing method/text fields or handoff notes.

Checker procedure: read the original sources, list their required outcomes,
and compare them with the draft cases and supplied diff. State coverage limits
when sources are incomplete. Look for missing boundaries, ambiguous
criteria, and probes that cannot distinguish success from failure. Check how
fixtures/fault injections will be proven effective. Also identify duplicate or
out-of-scope cases; review must not only expand scope.
Check that groups reflect independently reviewable user tasks and that each check
can be accepted or rejected on its own. For flow plans, inspect flow titles as
the resulting default checklist categories: flag an umbrella PR group that hides
distinct journeys. Check entry-to-outcome reading order, real transitions, and
expectations duplicated across groups; coverage alone does not make a plan ready.

Checker output:

- Decision: ready, or changes needed.
- Requirement-to-case coverage, including uncovered requirements and source limits.
- Findings: source/case ID, gap or unnecessary case, reason, minimal proposed change.
  If none, say so; do not rewrite the whole plan.

The primary resolves material findings before execution and saves the agreed
plan with the resolutions. A "ready" decision — or "changes needed" with every
material finding resolved — is the plan gate; execution starts without asking
the user. For frozen plans, record uncovered requirements in review notes and
the final narrative tail; do not add items or switch report modes within that
round. If a required outcome cannot be verified under the supplied plan, report
the limitation. The primary requests a corrected plan from its owner rather
than claiming full acceptance.

## 2. Final evidence review

**One quick check of the completed report and evidence.** Complete in-round
repairs and reruns before the handoff. Use the supplied diff only to understand
updates and their mapping to agreed cases, then check report claims against
the plan and original artifacts. Do not reopen requirements, add cases, or
expand into code review. A diff alone proves neither a pass nor a failure.

Primary input:

- The agreed plan (with the plan-review resolutions folded in) and any
  subsequent scope/plan changes.
- Completed report and per-case evidence index: expected behavior, actual observation,
  tested revision, original artifact paths, and the primary's proposed result.
- Runtime/build provenance, fixture/injection evidence, unexecuted cases, reused
  evidence and its original revision, and known limitations. File timestamps or
  a checkout SHA alone do not prove which build produced a screenshot.
  Correlate the target revision with the running instance's build/version marker,
  or probe a changed value in that instance that distinguishes it from the old
  implementation. State limits when exact build identity cannot be established.
- Any repair made during the round, stated by the primary in plain language:
  which cases it affects and which artifacts are first-run versus re-run.
- Code context per the shared contract, including in-round repairs and the
  primary's mapping of updates to affected agreed case IDs.
- For temporal claims, the original clip plus available timestamped frame sequence
  and relevant intervals. Selected assertion frames are navigation aids, not proof
  that the intervening transition was correct.

Checker procedure: inspect each case's original evidence against
its expectation and the primary's observations and verdict. Open images;
file existence and captions are not visual verification. For flicker or transitions,
inspect the relevant sequence, extracting frames into the ignored review
directory if necessary. Do not claim to have watched a video when only stills
were inspected. State sampling limits; sparse
frames cannot establish the absence of a one-frame defect. Check that every
plan item has a result and every declared evidence type is present.

Checker output:

- For every case: what the evidence shows, inspected paths/intervals, whether it
  meets the expectation, and whether the primary's proposed result is supported.
  Keep passing entries brief. For a disagreement or insufficient evidence, cite
  the specific frame, timestamp, log excerpt, or missing artifact.
- Action for each finding: clarify the mapping/report, supplement evidence,
  rerun, or repair then rerun.
- Overall decision: evidence supports acceptance, or further work is required;
  include known coverage limits from the plan review and inspection limitations.

These are review notes, not new report status values. The primary maps unresolved
findings to the existing schema without treating missing evidence as a pass.
A checker label alone is not proof; the primary must resolve supported objections
with evidence or disclose them, never silently override them.
The primary resolves findings and verifies any corrections without another
checker response. Disclose artifacts or verdicts changed after the check as
primary-only in the narrative tail.

## After the first round

Follow-up rounds have no checker. The primary repairs, re-runs affected cases,
inspects new artifacts, and discloses changes in the narrative tail. Preserve
unaffected results with their original provenance. If scope,
surface, or business goal materially changes, it obtains any user-owned decision
and revises the plan. Published rounds remain immutable; follow existing
new-round rules. No per-case approval loop, independent execution worker, or
third audit agent.
