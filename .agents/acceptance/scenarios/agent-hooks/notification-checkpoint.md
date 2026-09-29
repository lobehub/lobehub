# Notification boundary supplement — not final acceptance

Latest Stop repair is submitted and temporarily integrated; see [stop-retry-checkpoint.md](stop-retry-checkpoint.md). Earlier candidate/uncommitted status below is historical. Cloud product evidence and final independent repair review remain open.

Integration base `a471e3876a3ecd25cb233108754e1be3f0ac2cc3` incorporates C2 `834963412a25506add4cb8de4721d4dc17957f57` without conflicts, retaining S/K/L and C1/H/F/T. Docs merge `6f1946646e69a2f18b9ef7e259f2aed2cc7218c8` is the executed source. No D product repair was added. Earlier `.acceptances/hooks-d-integrated-r1/` evidence remains bound to `858b2d45`; it is not relabeled as testing this change.

Affected criteria: H09/H10/D03/D04. New evidence is `.acceptances/hooks-d-notification-r2/assets/`; the ignored `driver.ts` and `worker.ts` preserve the exact fixture and process boundary. This is a bounded runtime supplement, not the final report or a published acceptance.

## Scope and provenance

Actual `execAgent({hooks})` creates each operation in D's PostgreSQL. The fixture saves two synthetic action groups with synthetic native IDs into the operation's Redis host, with `stepCount:1`; it then calls the real `executeStep` for stale step 0 from separate Bun worker processes. The production dispatcher sends actual HTTP POSTs to D's receiver at 127.0.0.1:58092. Runtime and step locks use D's Redis. There is no mocked fetch, state store, lock or runtime. The stale step prevents LLM/tool effects after draining.

This deliberately does **not** exercise a real committed approval or creation of a Cloud continuation. It does not prove UI membership, review-token invalidation, stop, model inference or managed QStash delivery. Local QStash 2.37.18 was started from the existing isolated binary on 58080; it is infrastructure only in this supplement. Optional integration logging reports missing bearer credentials; the targeted DB/Redis/HTTP paths and assertions are independently observed.

## Targeted observations

- A real held step lock prevents HTTP dispatch and leaves both groups persisted. Because this is a stale step, the existing runtime returns success rather than `locked:true`; the first driver assertion assumed the wrong return shape. The initial failed fixture artifacts are retained and excluded from successful evidence. The corrected driver checks the actual criterion: no delivery, intact ledger.
- First action succeeds, second receives HTTP 503 with `fallback:'none'`: `CriticalHookDeliveryError` escapes through L's catch and only the second group remains. A fresh process receives that remainder, delivers it and saves an empty list. Another fresh process emits nothing. HTTP sequence: approve, reject, reject.
- Ordinary HTTP 503 is logged/swallowed and consumed. A new process does not redeliver it. Notification bodies deliberately contain deny/updatedInput, and the persisted runtime remains running with an empty event list.
- The crash fixture exits the worker process with code 75 immediately before its first consumption save, after actual HTTP delivery. Redis retains both groups. It waits 125 seconds for the real 120-second lease to expire, without deleting the lock. Replacement receives approve again, then the second-group failure/recovery yields approve, approve, reject, reject. This records an actual process-loss window at an injected boundary, not a natural machine outage.

`results.json`, per-worker JSON files, `receiver.jsonl` and `crash-boundary.json` correlate operation IDs, native IDs, PIDs and timestamps. Group-level multi-endpoint partial failure remains a documented code boundary, not a newly exercised endpoint matrix. Legacy/stop crash-loss behavior is not claimed as observed here.

## Quality and commands

```bash
ASDF_NODEJS_VERSION=24.21.0 bun run check --lint --test --type \
  apps/server/src/services/agentRuntime/AgentRuntimeService.ts \
  apps/server/src/services/agentRuntime/__tests__/hooksIntegration.test.ts \
  apps/server/src/services/aiAgent/__tests__/execAgent.resumeApproval.test.ts
```

D result: **210 tests passed, lint clean; full type failed**. `types-base.log` is from the new integration-base before switching back to docs. Diagnostic text extracted from it and `check.log` is byte-identical: **1444 / 1444**, recorded in `type-comparison.json`. No dependency install, lockfile change or shared store write occurred. The earlier 1103-test run remains earlier evidence; it was not rerun solely for the merge.

Reproduction uses a **fresh evidence directory**, D's existing private isolation profile and the preserved driver/worker. Source `.records/env/hooks-d-isolation.env`, evaluate `.agents/acceptance/scripts/init-dev-env.sh env`, then set `ASDF_NODEJS_VERSION=24.21.0 AGENT_RUNTIME_MODE=queue` for Bun. The receiver runs inside the driver and closes on completion. Stop only this supplement's recorded QStash process; keep D DB/Redis and their data. No app, gateway, device or browser is needed for this limited boundary test, and no new served-Web SHA is claimed.

## Retained blockers

The prior actual rewrite-card mismatch, Cloud overlay `DEFAULT_ASR_MODEL` compilation failure, missing real provider configuration and managed QStash access remain unresolved by this delta. New notification results do not convert any complete 31-item criterion to pass. Coordinator light-review closure and the same acceptance-checker's final evidence review remain outstanding. PR20137 stays draft and public bilingual docs remain unpublished.

## Independent review handoff — pending owner closure

Coordinator reports the initial independent review was static, with no tests run and partial F/T/C1 sampling. The coordinator subsequently reports **C2 reproduced P1**: critical Stop receives HTTP 503 after terminal persistence, then the same resolution retry skips dispatch and falsely returns success. C2 is implementing an atomic operation pendingStopHookBatchId and scoped consumption with DB regression coverage; the fix is not yet submitted. This is owner reproduction, not an independent D reproduction or a fixed result. Ordinary best-effort failures remain the intended policy and must be distinguished from critical failure. Existing stop crash-loss documentation is not evidence that this retry behavior is acceptable. The eventual fixed SHA must receive targeted negative Stop/retry verification before closure.

Coordinator also reports C1 CI has nine executeStep.test.ts failures from a missing createRuntimeToolPreparation mock; C1 owns the repair and a new head is pending. D's prior selected test runs do not establish this omitted CI path passes. No speculative product repair or upstream merge is made by D.

The nonblocking latency documentation finding is addressed in both protocol drafts: named awaited producers, sequential per-endpoint fetch timeout (default 30 seconds), QStash publish versus target delivery, fallback wait, and ignored responses. This documentation-only update needs focused lint, not another product run. Public pages remain unpublished while product gates are open. The coordinator owns the final combined repair review; D's single final acceptance evidence review remains unused.
