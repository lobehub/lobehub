# Real Cloud conversation approval — r23

The conversation UI now has real single and partial-batch approval evidence. This supplements r20 token API and r21 partial API results; it does not turn the unavailable browser token fallback, Stop rendering defects or model-dependent outcomes into passes. The token link's existing Mobile Universal Link consumer is outside this executed platform scope; see [r20 platform attribution](cloud-token-checkpoint.md). Conversation source-card interactions do not prove Mobile or browser token-link UI.

## Fixed environment and the pending-card investigation

Private Cloud `69c38102cf1af86917737a96aa02829c1e2eadb4` served nested OSS `ab5d35a6d7b4f009866677f4304b29dea9ac0da1`. Docs at execution were `2c414d4f4e96efb7ec8fdf1af06aa992918e2d88`. D's private Cloud cwd, Node 24.21.0/Bun 1.4.2 and isolated dependencies were retained. The app used real local QStash callbacks at 39927. Notifications were enabled, Live Activity disabled; no registered push devices or external messages were used.

D's local Agent Gateway at 58083 was started for this round. Device Gateway/CLI execution was not started. Previous r20–r22 pending skeleton captures had no Agent Gateway running; they cannot establish a permanent product block or a new Hook regression by themselves.

The initial conversation request returned `message.getMessages` HTTP200, and gateway-token/settle requests completed. A read-only client projection then showed no messages, a completed local runtime operation and no gateway connection. A normal browser reload displayed the B permission card. No store mutation, UI injection or product edit was used. The HAR did not preserve the initial message response body; HTTP200 alone does not prove its contents.

Source inspection identifies a plausible boundary: `Conversation/store/slices/data/action.ts` drops SWR `onData` while the local runtime is running, before initializing messages; `resolveMessageListFeedback.ts` shows the skeleton while messages are uninitialized. Reconnect creates local running state. This is a source-backed explanation consistent with the observation, not an instrumented proof that this gate caused that specific request to be dropped, nor a base/current regression attribution.

Subsequent [targeted diagnosis](pending-ui-diagnosis.md) reproduces that deferred-sync mechanism with actual Conversation/SWR code and the same fixture against exact pre-F/current source. It establishes an existing client synchronization boundary, while retaining the missing direct callback/body evidence for this historical live request. No r23 artifact or served SHA was changed.

## Real single-card flow

Source `op_1790614789122_agt_gZf2QSTOMnA9_tpc_ETKn3lYqhuzJ_ZCNprh7l` was created by actual `execAgent` with explicitly seeded `llm_result`. Controls and the real Cloud adapter created pending Review and B tool preparation. The authenticated user clicked the actual conversation Submit button. The real source resolver and queue worker rechecked controls, produced C and reparked; the visible C permission card updated without a reload after Submit.

The same tool row and assistant parent remained. `originalArgs` retained A, `approvalArgs` retained B, and durable/effective arguments became C with context C. B/C/original marker files stayed absent and no after-tool event occurred. Stop through the real button interrupted the continuation and cancelled the review without executing the tool.

Separately, a current real notification token with a resolution request ID belonging to another batch returned HTTP409. Selected operations/reviews/messages/resolutions and receiver count were unchanged. This proves foreign **resolution identity** isolation, not another user's token ACL.

## Real partial-batch Web flow

Source `op_1790615278734_agt_LkXMyP2z5X5S_tpc_lNan95XuYg0F_3lF78Sus` had two distinct native calls and durable rows, initially both B.

1. Submit for member 0 approved only that member. Its worker rewrote it to C and reparked; sibling 1 remained B/pending. Both members remained in the replacement Review and visible two-member picker.
2. The user selected the rejection option, entered a reason and submitted member 0. That member remained rejected; sibling 1 was still shown with B and could be reviewed.
3. Submit for sibling 1 reran controls and reparks it at C. The rejected member was not restored or executed.
4. Stop cancelled only sibling 1. Final persistence contains four operations, six Review rows, four messages and four resolutions, with tool states rejected/aborted.

Four decision HTTP groups contain the actual IDs: approve 0, rejectAndContinue 0 with the entered reason, approve 1, Stop 1. Repark does not produce a fake Stop. The same tool rows/parents and original A survive; both approval snapshots are B and both effective snapshots C. No original/B/C file or afterToolCall/onToolCallError event exists. This is real Web interaction over Cloud source APIs, not a fabricated Review ledger. Whole-object `reapprovedToolCallIds` forwarding remains a source-backed inference corroborated by durable supersession, not a captured function-argument trace.

## Evidence and limits

Round `.acceptances/hooks-d-web-pending-r23/` contains `assert-results.py` and `assets/{result.json,provenance.json,ui-http-summary.json,decision-events.json,runtime-projection.json,db-critical-*.json,db-batch-*.json}`. Six actual Web source mutations returned HTTP200; token foreign-resolution conflict is recorded separately. Single and batch approval videos each contain 24 frames over 24 seconds; first/middle/last frames were visually inspected. They cover B Submit to C repark, not every later reject/Stop interaction. Screenshots and HTTP/DB captures cover those later steps. `card-B.png`, `settled-before-reload.png`, `batch-C-B.png`, `batch-pending-sibling-B.png` and `batch-sibling-C.png` show the actual cards.

Stop still leaves actionable-looking pending controls until reload. Cold rendering still shows an Edited C file, and the batch aggregate appears successful despite rejected/aborted tools and absent files. Those existing UI failures remain visible in `stop-stale.png`, `stop-cold.png` and batch equivalents. No complete Stop UI pass is claimed. The standalone notification-token Web URL remains the r20 unknown route; custom cancel remains unavailable in the r22 actual producer. Cross-user ACL, all-approved/all-rejected batches, combined crash windows and successful parent/model replies are not inferred from these flows.

No successful model call, device execution or managed QStash delivery is claimed in r23. Earlier r7 real device evidence retains its original SHA. Private HAR and token-bearing notification/request artifacts are excluded from publication. The evidence manifest hashes the remaining local files; final upload and acceptance-checker review have not occurred.

Both fixtures were stopped through the UI. The named browser and cwd-verified app, receiver, local queue and Agent Gateway process trees were terminated; `teardown*.json` records empty owned ports and retained D databases. No install, product edit or upstream branch change occurred. Existing r19 quality remains 39 router tests/lint passed, full type 1444/1444 failed with normalized diagnostic equality. This checkpoint adds documentation only.
