# Ready continuation with missing source — r15

This supplements the missing-source rejection evidence; it does not repeat C04 or close the full generic UI criterion. Private Cloud remains `69c38102cf1af86917737a96aa02829c1e2eadb4`, nested OSS served `5b762f884d681e301f62a379ceb3a896382c6c08`, D docs at execution `38cbf1150246b0a3afb7c9c2c390a1f330093390`. No product source, dependency, or shared service changed. C2 ff0f8dba and its early-preflight successor 3fc72ae6 are both ancestors of that base.

## Setup and explicit fault

A new real execAgent operation plus explicitly seeded llm\_result produced a tool row and real Cloud durable pending Review. Its HTTP control rewrote A to B/context B. The actual Cloud source-resolution service won an approve-once claim; programmatic execAgent with the returned runtime action and `autoStart:false` persisted a deterministic continuation in ready state. This setup uses real provider/model/runtime persistence, but the initial claim is a programmatic setup, not a user clicking a token or card. No SQL Review/state rows or host event ledger were fabricated.

Source: `op_1790608434731_agt_b6j9X6mGmeXa_tpc_lnbiQ4j0lwmb_YDWmppsX`. Continuation: `op_intervention_65b7b46b64fe19d33c8c47d537a204a6`.

After ready persistence, the harness called PEXPIRE 1 only on this source's Redis state, then confirmed absence. It did not expire the new continuation or alter SQL. The old r7 hookless record was untouched. Direct execAgent re-entry first encountered the outer topic-start reservation (`Topic ... remained busy`) before reaching reuse; that failed harness attempt is retained in reuse.private.log, not counted as a successful direct-service retry.

The subsequent check uses the actual authenticated Cloud `aiAgent.resolveAgentInterventionBySource` HTTP API with the same persisted resolution request. D's existing `AGENT_RUNTIME_BASE_URL` is set to its reserved but **unstarted** worker port 39928. Cloud Web serves 39927 and local QStash 58080 is real; this deliberately separates scheduling/recovery from worker execution. No remote or successful worker target delivery is claimed.

## Observed result

- Before the HTTP retry, the older source is absent. The continuation has its own 17 hooks, one pending intervention event group and matching ready preparation/provenance in Redis and PostgreSQL.
- The authenticated source retry returns HTTP200, claimed/approved/success true. It schedules **the same** continuation through local QStash and persists the scheduled marker/deduplication identity. The source operation becomes done through the normal router retirement path.
- The continuation's state projection (status, preparation, hooks, event group), all four message projections, B/original/context snapshots and operation count (two) are unchanged. Receiver log stays at ten lines: there is no new control/notification execution and no new event group. B/C files remain absent.
- Repeating the identical request returns already\_resolved/approved. The complete selected DB/Redis/receiver snapshot is identical to the first retry snapshot; no second operation or group is created.

This proves the actual Cloud source recovery route can schedule from ready persisted continuation state after the older source disappears. It does not prove a direct execAgent retry can bypass the topic reservation, token-link validation, pending-card UI, group consumption by a worker, tool effects, or next-model context. The separately observed r14 critical Stop route defect remains open.

## Evidence and cleanup

Root: `.acceptances/hooks-d-ready-reuse-r15/assets/`.

- `before.json`: actual ready continuation before deterministic source expiry, with its hooks/event group and messages.
- `request.json`, `reuse-first.json`, `reuse-replay.json`: real authenticated source API calls/results, using the original claim identity.
- `db-pre-api.json`, `db-after-api.json`, `db-replay-api.json`, `result.json`: selected SQL/Redis comparisons and recorded queue dispatch identity; source absence is confirmed in all three snapshots.
- `fresh-receiver.jsonl`, private app/QStash/driver/reuse logs and the temporary scripts retain setup and fault boundaries. Private logs require review before any public upload.
- After snapshots, the actual interruptTask API was called solely to stop this new synthetic continuation; `cleanup-interrupt.json` and `db-cleanup.json` record that separate cleanup. The browser and verified D Web/QStash/receiver process tree were then stopped; 39927/21458/39928/58080/58081/58098 have no listeners (`teardown.json`). D DB/Redis remain. No device or gateway process was started.

No product diff or new type test was introduced: the affected source-preflight checks already recorded 53 tests/lint and 1444/1444 identical D type diagnostics. This new evidence narrows the ready-reuse gap only; it does not turn the 31-item acceptance or Stop UI into a pass. Final independent reviews remain unused.
