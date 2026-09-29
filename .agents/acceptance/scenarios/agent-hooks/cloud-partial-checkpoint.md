# Real Cloud partial Review checkpoint — r21

This round verifies actual Cloud token APIs, durable supersession and local queue workers for two seeded binary tool calls. It is not model inference, a Review Web-card click flow, heterogeneous mixed surfaces or managed QStash evidence. Original r7 Web/device evidence keeps its original SHA and was not repeated.

## Version and entry

Private Cloud `69c38102cf1af86917737a96aa02829c1e2eadb4` served nested OSS `ab5d35a6d7b4f009866677f4304b29dea9ac0da1`; docs at execution were `6c09f60fd5f2eaf1abb65a496c119694e2ca947d`. Cwd was D `.records/hooks-d-cloud`, Node 24.21.0/Bun 1.4.2, with unchanged isolated dependencies. The app used real local QStash callbacks on 39927, unlike r15/r16's scheduling-only target. Three actual `POST /api/agent/run` HTTP200 callbacks were observed.

The real `execAgent` entry consumed an explicitly seeded two-call `llm_result`, ran HTTP controls and used the Cloud adapter to persist Review rows plus notification action URLs. Each token was read from its actual NotificationService row and used by the authenticated synthetic user. No direct Review-model calls or synthetic ledger replaced claim/notification behavior. Notifications were enabled, Live Activity disabled, and no push devices were registered. No local device/gateway was started.

Source operation: `op_1790612319272_agt_lkKFtVz4PVHM_tpc_nhAIsPMXb5lQ_BCNlsJpW`. Native calls are `call_reapproval-manual-block-1790612319130_0` and `_1`; their durable tool rows are `msg_HzF2t3SXtX9cgCwonr` and `msg_3v0MjSr6YwENHWNOJL`, under parent `msg_cWmbPlvVBtnKhDkTb8`.

## Observed state transitions

1. Both calls start pending with effective B. Approving only member 0 through its actual token creates continuation `op_intervention_9fcf277965841b6e8ffabc5d45845779`. Its real worker reruns controls, rewrites that member to C and reparks. The untouched sibling remains B/pending. The replacement batch includes both members; old reviews become session-ended. Same parent/native IDs/tool rows are preserved; original A, approved B and effective C remain distinct.
2. Old token reads and old/new resolution requests return HTTP200 terminal `session_ended` without effects. They are safe terminal no-ops, **not HTTP rejection evidence**. A current token carrying old request revisions returns **HTTP409** with the changed-request error. The selected DB snapshot remains unchanged.
3. Rejecting only member 0 through the replacement token starts continuation `op_intervention_cfe42b98081b7baf327ace5aa9ad7df6`. Its worker leaves member 0 rejected and carries only pending sibling 1 into the next batch. This decision emits rejectAndContinue, not Stop.
4. Approving sibling 1's B through its actual new token starts continuation `op_intervention_c00469671799dff7c45428c2f57c5522`. Its worker reruns controls to C and reparks only that sibling. The rejected member is not executed or restored to pending. Both rows retain original A and approval B independently from effective C.
5. Two concurrent old-token approve/reject requests both return terminal session-ended. Persistence is unchanged after sorting list entries by ID; raw SQL row ordering differs, so raw-byte equality is not claimed.
6. Stop through the latest actual token interrupts the final operation and cancels only pending sibling 1; member 0 remains rejected. Four decision-event groups contain exactly the effective IDs: approve 0, rejectAndContinue 0, approve 1, Stop 1. No repark generates a fake Stop/success decision.

Final evidence contains four operations, four messages, six Review rows and four resolutions. Runtime projections retain 17 hooks; queued host event groups are consumed. No original/B/C file exists and no afterToolCall/onToolCallError event occurred. This demonstrates repark without tool execution; no unobserved primitive attempt counter is asserted.

The cross-operation replacement behavior, together with inspected model validation and Cloud whole-object forwarding, supports the `supersedes.reapprovedToolCallIds` path. The DTO was not captured at its function boundary: whole-DTO forwarding is a source-backed inference corroborated by the real result, not an instrumented payload claim. This is a homogeneous binary-tool batch with sequential mixed decisions, not askUserQuestion/custom-action or heterogeneous-batch coverage.

## UI and remaining scope

The actual token Review page is unavailable as recorded in [r20](cloud-token-checkpoint.md). Pending conversation views remained a running skeleton; its rendering/reconnect cause is unresolved, and no pending C card is marked passed. After final Stop, cold rendering shows both C paths and their respective rejected/cancelled details (`partial-final-both-details.png`, visually inspected). It still incorrectly displays green +1 and an Edited C aggregate. Final projection evidence does not replace pending approval-card interaction or a successful parent reply. No required UI-flow video was captured.

Source missing/read-failure and ready reuse retain r12/r15/r16's bounded evidence. Custom cancel, heterogeneous mixed batches, complete UI and real model/managed QStash remain uncovered or blocked as applicable. These API/worker results do not close the full 31-item acceptance or grant another independent-review conclusion.

## Evidence and teardown

Raw round: `.acceptances/hooks-d-cloud-partial-r21/assets/`. `provenance.json`, `result.json`, `server-summary.txt`, receiver JSONL, redacted request/API files and `db-partial-*.json` record the transitions. `assert-results.py` in the round root checks member identity, snapshots, revisions, event IDs and absent effects. Private notification/request files contain tokens and are not publishable.

Historical harness filenames `api-third-reject-first.json` and `api-fourth-reject-first.json` use a generic execution label; the stored request/response proves the actual actions are approve and Stop respectively. Do not interpret filenames as decision evidence.

The named D browser and cwd-verified app/receiver/queue PID trees were stopped. `teardown-processes.json` and `teardown.json` record cleanup and empty ports 39927/21458/39928/58080/58081/58096/58097. D databases remain; user Cloud and shared services were untouched. No install or product edit occurred. Existing r19 quality evidence remains 39 router tests/lint passed, full type **1444/1444 failed** with normalized diagnostic equality. New changes here are documentation only.
