# Real Cloud source Review checkpoint (r14)

Follow-up: [r17](cloud-stop-route-checkpoint.md) observes the repaired source-router retry on `196787eedd`. The failure below remains the immutable r14 result; old completed resolutions were not reopened. Token/full UI and other gaps are not inferred passed.

This is partial product evidence, not final acceptance. D served private Cloud `69c38102cf1af86917737a96aa02829c1e2eadb4` with nested OSS integration `5b762f884d681e301f62a379ceb3a896382c6c08` (including C2 `3fc72ae6`, H/C1/S/K/L). D docs were `2090355f` during execution. Runtime Node was v24.21.0 and Bun 1.4.2. No installation or product patch was made.

The private Cloud combination retains base `4b2a3272`, official ASR `49164e45`, const-only `2c604fc1`, and official Spin `f722d1c1`. The const-only private commit `4fe5a9fc` changes only `packages/business/const/src/index.ts`; its diff is byte-identical to that upstream file's six-line patch, with the upstream gitlink omitted. This is a partial upstream compatibility patch, not a full cherry-pick of `2c604fc1`. Cloud was not pushed and the user's Cloud checkout was not changed.

## Entry and evidence boundary

The driver imports the real Cloud tsconfig aliases and invokes `execAgent({hooks})`, then supplies an explicitly seeded assistant tool result to the real runtime. The before-tool endpoint rewrites the input to B. The real Cloud notification provider creates the durable pending `agent_interventions` row; no model method was called to create a Review fixture. Push/live-activity delivery is disabled only for D; durable Review persistence remains enabled.

The browser is authenticated as synthetic `user_agent_testing_001`. Its actual `message.getMessages` response contains effective B, original A and context B. Authenticated `aiAgent.getAgentInterventionReviewBySource` returns HTTP200, `handled:true`, pending, `canView:true`, `canResolve:true`, with B in the review details. This removes the OSS no-op limitation for the observed source API path.

The pending conversation nevertheless remained a skeleton: a topic running marker caused gateway reconnect to create a running local operation, and the conversation fetch guard did not project the returned messages. Starting D's real local Agent Gateway connected successfully but did not settle that fixture-created stream. This is an observed fixture/UI boundary, not an established production root-cause attribution. No store state or database marker was manually changed to bypass it. The following mutations used authenticated browser fetch to the real source resolver, **not a UI card click or token-link Review action**. Token, pending-card, partial/mixed and reapproval coverage remain open.

## Ordinary successful Stop

Operation `op_1790606983510_agt_8CDRU7jALfS8_tpc_E7Ygj9uWitlW_sgb4Fx3M`:

- First actual `resolveAgentInterventionBySource` Stop returns HTTP200, claimed/stopped/success true.
- DB Review becomes cancelled, resolution completed, operation interrupted; the same tool row is aborted with the user-stop content. Original/effective/context snapshots remain intact; plugin error is null.
- The HTTP receiver records one `onStopByHumanIntervention` for the exact native tool ID. Same-request replay returns already\_resolved/stopped and produces no extra delivery.
- There is still only one operation and three messages; B/C files are absent. No continuation or device execution was started.
- After cold reload the actual UI renders B and the cancelled detail. It also still renders the incorrect `Edited policy/B.txt` and green +1 from request arguments. This is the retained existing Stop UI defect, not a successful full UI check. The screenshots were opened and inspected.

## Critical Stop failure: generic router still reports success

Operation `op_1790607660878_agt_kpERRNMsdD0V_tpc_57KmEEuaTAMw_g5tpUvKq` has a real `onStopByHumanIntervention` HTTP endpoint configured with `fallback:'none'`.

| Attempt                            | Receiver setting / observed requests | Actual source API result                          | Durable state                                                                         |
| ---------------------------------- | ------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| First                              | 503 / one request                    | HTTP200, claimed, stopped, success true           | interrupted + pendingStopHookBatchId retained; Review cancelled, resolution completed |
| Same request                       | 503 / no additional request          | HTTP200, already\_resolved, stopped, success true | pending marker retained                                                               |
| Same request after endpoint repair | 200 / no additional request          | HTTP200, already\_resolved, stopped, success true | pending marker retained                                                               |

The server logs `Critical webhook delivery failed`; all three snapshots still show no B/C file, no new operation, and no tool side effect. This **fails** the real generic critical-delivery retry criterion. The earlier service-only r4 retry evidence remains valid for that narrower entry but does not cover this router.

Initial source trace: `dispatchClaimedAgentIntervention` catches the delivery error, calls `probeRuntimeActionDispatch`, observes dispatched business state and continues to `onAgentInterventionResolutionPublished`. The generic completed resolution then short-circuits subsequent same-request calls as already\_resolved. This trace and the actual HTTP/DB evidence were sent to C2 and the coordinator; D made no product fix and has not closed P1 or used either final review gate.

## Artifacts and remaining coverage

Evidence root: `.acceptances/hooks-d-cloud-review-r14/assets/`.

- `provenance.json`: exact Cloud/OSS/ancestor/runtime and partial-patch identity.
- `messages-api.json`, `review-source.json`: actual authenticated reads, no synthetic Review provider.
- `stop-request.json`, `stop-first.json`, `stop-replay.json`, `db-{before,after,replay}.json`, `fresh-receiver.jsonl`: ordinary Stop and replay.
- `critical-stop-{request,first503,second503,third200}.json`, `db-critical-{before,first503,second503,third200}.json`, `critical-receiver.jsonl`: failing critical sequence.
- `before-stop-api.png`, `after-stop-reload.png`, `after-stop-expanded-settled.png`: inspected skeleton and final rendered cancellation/false Edited state. No pending-card click video exists; no claim is made for it.
- Private app/driver logs are retained locally and are not suitable for unreviewed public upload. `teardown.json` records only D-owned processes and the named browser being stopped.

H03/H10/D06 now have actual Cloud source-API observations; H10/D06 critical retry remains failed, not environment-blocked. Full H09/C04 token, partial/mixed, supersession and card flows remain unverified. Provider inference/next-prompt/parent reply and managed QStash still lack external test configuration. A connected-device label in this round is not evidence of execution: no device process was started. No new full type pass is claimed (the retained D fixed-environment result remains 1444/1444, unchanged diagnostics).
