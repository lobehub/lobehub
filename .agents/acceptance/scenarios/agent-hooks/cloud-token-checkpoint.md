# Real Cloud token Stop checkpoint — r20

This is bounded product evidence, not a complete acceptance verdict. The actual Cloud adapter created durable Review rows and a NotificationService record; the authenticated synthetic user used the token from that record through the real Review API. No Review rows, token, resolution ledger or provider response were fabricated. The initial two tool calls were explicitly seeded `llm_result`, not model-generated.

## Served environment

- Private Cloud: `69c38102cf1af86917737a96aa02829c1e2eadb4`, including the previously authorized official compatibility patches.
- Nested/served OSS: `ab5d35a6d7b4f009866677f4304b29dea9ac0da1`; D docs at execution: `6c09f60fd5f2eaf1abb65a496c119694e2ca947d`.
- Cwd: D worktree `.records/hooks-d-cloud`; Node 24.21.0, Bun 1.4.2. Isolated dependencies and DB/Redis retained; no install or user Cloud change.
- App 39927/Vite 21458. Stop-only worker target 39928 was deliberately unstarted; no device/gateway was started.
- Notifications enabled, Live Activity disabled, synthetic user's registered push devices verified as zero. NotificationService archived the actual notification and persisted its action URL; no external push recipient was involved.

## Real token sequence

Source operation: `op_1790612087538_agt_0sMqOR8ZxLhe_tpc_oeLNPLk6cDAE_1XBpkJr6`. Two pending native IDs end in `_0` and `_1`. Authorized `getAgentInterventionReview` returned both pending items. The same token Stop resolution request, including expected batch version and item revisions, then produced:

| Delivery response | API status | Total critical HTTP receipts | Durable outcome                                                 |
| ----------------- | ---------- | ---------------------------- | --------------------------------------------------------------- |
| First 503         | 500        | 1                            | Both reviews/resolution resolving; pending Stop marker retained |
| Second 503        | 500        | 2                            | Same claim/marker retained                                      |
| 200               | 200        | 3                            | Both reviews cancelled; resolution completed; marker consumed   |
| Replay            | 200        | 3                            | Selected DB snapshot unchanged; no redelivery                   |

Each Stop event contains both native IDs. There is one operation and four messages throughout, no continuation/worker execution and no B/C file. The successful token response reports stopped; this is not a claim that every endpoint returns an `already_resolved` field. Ordinary best-effort source behavior remains covered by r17, not rerun here.

## Actual UI gap

The actual notification URL at `/agent-approval` opens **Entered Unknown Territory** in the authenticated browser. The fixed Cloud/OSS source has the URL producer and API, but no corresponding Web page registration was found. `token-page.png` was visually inspected; it contains no token. The browser fallback is failed/unavailable in this tested deployment; this is not evidence of a newly introduced Hook route omission. The model-config 500 did not prevent the demonstrated Review API flow; successful inference remains blocked.

Platform attribution was subsequently clarified by the coordinator's official-source check: [Cloud PR1518](https://github.com/lobehub-biz/lobehub-cloud/pull/1518) identifies Mobile consumer PR248 and follow-up PR258. The coordinator verified PR248 merged at `890d9c97c5747250bb107e9bf78447e7b6268932`, with `src/app/agent-approval.tsx` implemented using Expo Router/React Native. D independently read the private Cloud `buildReviewUrl` comment about the matching Mobile server and its AASA test/public association: `/agent-approval` is associated with `4684H589ZU.com.lobehub.app`. D's attempted GitHub refresh was blocked by unavailable Lody identity verification, so the Mobile PR/source details above remain explicitly coordinator-verified, not a fresh D remote inspection.

The evidence therefore points to the existing Mobile Universal Link consumer and an unavailable browser fallback in the tested version. It does not establish that every remote deployment lacks a Web page. Mobile token UI was **not executed**; no Mobile setup, user-device access or new Web route is part of this task. The token API sequence above remains valid. The normal conversation source cards exercised in [r23](cloud-web-checkpoint.md) are a separate entry and cannot substitute for token-link UI acceptance.

Cold conversation rendering after Stop shows the two-call group and an incorrect Edited B summary despite no file execution (`token-stop-conversation.png`, visually inspected). It does not prove Review card actions or a successful parent model reply. No UI-flow video was captured, so required video coverage remains unmet.

## Evidence and cleanup

Evidence: `.acceptances/hooks-d-cloud-token-r20/assets/`:

- `provenance.json`, `result.json`, redacted `notification.json` and `request.json` establish the token source and scope.
- `api-review.json`, `api-first503.json`, `api-second503.json`, `api-third200.json`, `api-replay.json`, `api-review-after.json` record authenticated API results.
- `db-critical-{before,first503,second503,third200,replay}.json` and `critical-receiver.jsonl` correlate persistence and actual HTTP.
- Inspected screenshots above; `teardown-processes.json` and `teardown.json` record cleanup.

Raw token locators and logs remain private ignored files and must not be published. D's browser/app/receivers were stopped; the local queue was reused for r21 and then stopped. All owned transient ports were verified empty after r21; DB/Redis retained. No product code changed, no new code review or final evidence checker was invoked, and PR #20137 remains draft.
