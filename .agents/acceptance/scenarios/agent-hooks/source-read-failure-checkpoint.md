# Source Redis read failure and recovery — r16

Private Cloud `69c38102cf1af86917737a96aa02829c1e2eadb4` served nested OSS `5b762f884d681e301f62a379ceb3a896382c6c08` (C2 3fc72ae6 included); D docs were `0cd3dfd4b103690ef8f918e6e993b6212af75bbb` at execution. This adds the transient read-error boundary to r12's deterministic missing-source rejection and r15's ready reuse. No product changes, dependency install, old pending-card action or repeated C04 run occurred.

## Real entry and fault boundary

A new execAgent operation plus explicitly seeded llm\_result created a real tool approval and Cloud durable Review. HTTP control produced B, retaining original A and context B. Source: `op_1790609030094_agt_NqxQBJ4fEzKH_tpc_Za7jWPgUc9mO_q9FsHb1U`.

D's temporary RESP2 TCP proxy on 56381 forwards to D's Redis on 56380, database 1. The private Cloud process alone points at that proxy. Only GET of this exact source-state key can return `ERR D_SOURCE_READ_FAILURE`; other commands/keys are forwarded, with replies serialized to preserve pipelined order. No Redis source data was deleted. The proxy writes a hit log with the operation key and injected error, never credentials or arbitrary values. No application method/provider is replaced.

All actions use the logged-in synthetic account and the actual `aiAgent.resolveAgentInterventionBySource` HTTP endpoint, with one unchanged approve-once request UUID. The Cloud worker endpoint is D's reserved but unstarted 39928; QStash is the real local simulator. Recovery therefore proves scheduling, not worker execution or managed-cloud delivery. These are API actions, not pending-card/token-link clicks.

## Failure observations, separated by read boundary

1. With every target GET failing, HTTP500 reaches an outer read before the target preflight. The source messages and operation remain identical; the generic claim rolls back to pending/rolled\_back. This is not evidence of a held post-claim resolution.
2. Passing the first two target reads still fails during the interruption/state-save boundary. The same no-success/no-new-message result and rollback occur. This intermediate probe is retained, not mislabeled as the preflight check.
3. Passing the first three target reads then failing the next reaches the source-preflight boundary after approval claim. The proxy records the three forwarded reads and the injected failure. The actual API returns HTTP500 with the injected error. SQL still has exactly the original operation and three messages; no successor assistant, operation, queue dispatch, receiver delivery or file appears. Tool content, B arguments, original A and additionalContext B are unchanged. The tool intervention is now approved under the submitted resolution with approvedArguments B; Cloud Review and resolution remain resolving under that same request. Generic ownership is preserved rather than reopened.

The older runtime state becomes interrupted through the normal outer replacement flow; its durable operation remains waiting\_for\_human at the failure snapshot. Do not call the entire runtime/claim state unchanged. Legacy pending rollback is separately covered by r12; this generic path intentionally retains an approved source claim for retry. Source-read ordering is supported by the proxy log and traced call path; history/discovery internals were not independently instrumented in this product run.

## Recovery under the same request

After disabling only the proxy fault, the identical authenticated request returns claimed/approved with one new deterministic continuation, `op_intervention_c0801b4c64b4ab547224c83977c31ebe`, scheduled through local QStash. The same resolution row becomes completed. The continuation persists 17 inherited hooks and one pending intervention event group. There are now exactly two operations and four messages. Receiver log remains at ten lines and B/C files are absent because the worker target is not running.

An identical replay returns already\_resolved/approved. The selected SQL/Redis/receiver snapshot is unchanged from successful recovery; it creates no duplicate operation/message/event delivery. This covers transient-error recovery through the actual generic source route, not token revision/concurrency, partial/mixed UI, worker consumption, tool effects or successful inference. The r14 critical Stop false-success defect is still open.

## Evidence and quality

Root: `.acceptances/hooks-d-source-read-failure-r16/assets/`.

- `ready.json`, `request.json`, `db-before.json`: new source and original pending snapshot.
- `redis-faults.jsonl`, `redis-read-order.jsonl`, temporary proxy script and policy: exact fault target, ordering and observed injection hits. The two earlier-boundary probes are preserved in `api-failing.json`, `api-preflight-failing.json` and matching DB snapshots; the latter filename is historical, not proof of the target preflight.
- `api-guard-failing.json`, `db-guard-failing.json`: actual HTTP500, no new assistant/operation, B snapshots and resolving ownership.
- `api-recovered.json`, `api-replay.json`, `db-recovered.json`, `db-replay.json`, `result.json`: same-request recovery and replay comparisons. API capability tokens are redacted from shared JSON projections; private server logs are not publishable without inspection.
- `fresh-receiver.jsonl`: no request after preparation throughout the failure/recovery/replay window.
- `cleanup-interrupt.json`, `db-cleanup.json`, `teardown.json`: after evidence snapshots, the actual interruptTask API is used solely to stop the new synthetic continuation. D browser, private app, queue, receiver and Redis proxy are stopped; their ports are empty. D databases remain, fault policy disabled. No device/gateway process was started.

The runtime tree is unchanged from the already checked 3fc72ae6 integration. The retained D affected checks are 53 tests/lint with full types at 1444/1444 identical diagnostics; C2's separate type-clean environment is not substituted. This documentation receives its own lint check. Neither final independent review nor acceptance-checker review is consumed, and no 31-item pass or acceptance URL is claimed.
