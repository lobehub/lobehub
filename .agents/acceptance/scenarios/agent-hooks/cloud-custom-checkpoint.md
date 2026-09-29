# Real Cloud custom and mixed Stop checkpoint — r22

The requested custom-cancel endpoint cannot be reached through the current runtime Marketplace producer. This round records the actual contract rejection, then verifies its supported operation-wide Stop on a real mixed custom/binary batch. It does not manufacture allowed actions or bypass the provider to claim custom-cancel execution coverage.

## Fixed environment

Private Cloud `69c38102cf1af86917737a96aa02829c1e2eadb4` served nested OSS `ab5d35a6d7b4f009866677f4304b29dea9ac0da1`; docs at execution were `72914081de10274cfd007578253536cc53d7822f`. Cwd was D `.records/hooks-d-cloud`, Node 24.21.0/Bun 1.4.2, with isolated dependencies unchanged. App 39927/Vite 21458, local QStash 58080, HTTP receivers 58096/58097; worker target 39928 was deliberately unstarted. No device or gateway started.

The real `execAgent` created operation `op_1790613454676_agt_7p9mJVgVSp6t_tpc_szPQ7fw8w8i0_fTXklk88`. An explicitly seeded `llm_result` supplied `lobe-web-onboarding/showAgentMarketplace` and `lobe-local-system/writeFile`; real controls, runtime, Cloud notify and DB created the two pending Review items and actual notification token. This is not successful inference. The picker prompt explicitly forbade installation; no template selection or marketplace installation occurred.

## Custom-cancel is not advertised

The actual authenticated token read returns batch kind `mixed`. Its custom member advertises `submit_custom`, `skip_interaction`, `stop`; its binary member advertises the normal approval actions. The batch advertises Stop.

`agentInterventionNotification.ts:164–167` explicitly reserves `cancel_interaction` in the v2 union but does not expose it until an operation-wide atomic cancel emitter exists across Web/Mobile. The producer regression also asserts that it is absent. Actual token `cancel_interaction` returns **HTTP400**, “This response does not match what the agent asked for.” The selected DB snapshot and receiver counts are exactly unchanged; no resolution is claimed.

Therefore custom-cancel critical retry is **unavailable through this producer contract**, not blocked by a model credential and not verified by this run. Owner tests constructing an internal custom runtime action do not prove that the deployed producer exposes it. D did not change allowedActions, create model/ledger rows directly or expand product behavior to enter that branch. This boundary was sent to the coordinator.

## Supported mixed Stop

A new resolution request uses the same real token with the publicly allowed operation Stop. The same request is retried after changing only the test HTTP receiver status:

| Receiver   | API         | Critical receipts | Persistence                                                    |
| ---------- | ----------- | ----------------- | -------------------------------------------------------------- |
| First 503  | 500         | 1                 | Operation interrupted, both Reviews resolving, marker retained |
| Second 503 | 500         | 2                 | Same resolving claim/marker retained                           |
| 200        | 200 stopped | 3                 | Both Reviews cancelled, resolution completed, marker consumed  |
| Replay     | 200 stopped | 3                 | Selected snapshot identical; no redelivery                     |

Each HTTP notification contains both native IDs: `call_reapproval-manual-block-1790613454552_custom` and `_binary`. There is one operation, four messages and one Stop resolution throughout. No continuation or worker starts, and the requested marker file does not exist. Topic metadata remains unchanged; custom execution state/attempt remain null. This is the ordinary Stop runtime action, **not successful execution or retry of the custom Marketplace handler**.

## UI and evidence limits

Opening the actual Review-provided conversation URL `/agent/agt_7p9mJVgVSp6t/tpc_szPQ7fw8w8i0` still shows a pending running skeleton (`mixed-pending.png`, visually inspected). Cold rendering after Stop shows paused custom/binary entries and an incorrect Edited marker summary; the expanded custom panel was still a skeleton (`mixed-final-details.png`, inspected). No cancelled-detail text or complete action-card flow is asserted from that image. Connected-device wording is cached UI, not proof of device execution. Model unavailable and model-config errors remain separate; API claims were reachable. No UI video was captured.

Evidence root: `.acceptances/hooks-d-cloud-custom-r22/assets/`. `provenance.json`, `result.json`, `producer-contract.txt`, redacted `api-review.json` and `custom-cancel-request.json` establish the contract. `api-custom-cancel-rejected.json` / `db-custom-cancel-rejected.json` preserve the rejected probe; initial harness `first503` filenames describe the attempted stage, not its actual HTTP400 outcome. Supported Stop has distinct `api-stop-*.json`, `db-critical-stop-*.json` and `critical-receiver.jsonl`. Private notification/token/request files are not publishable.

The D browser and cwd-verified app/queue/receiver PID trees were stopped, and all seven transient ports were verified empty (`teardown*.json`). DB/Redis retained. No install, product change, upstream merge, new code review or final acceptance checker. r7/r17/r20/r21 evidence is reused under original provenance. Full type remains r19's **1444/1444 failed** with normalized equality; this addition is documentation only. PR #20137 stays draft and full acceptance remains incomplete.
