# Cold approval projection and real OSS continuation — r7

D integration-base `81591e7112181cf29d0564af726ed6946a4acee1` includes C2 `507b37f9cb6c2675dfd8b735c4497caecd59a3bb`, with the fixed C1/S/K/L ancestry retained. Both merges were conflict-free. The actual served docs revision is `95d4056feaf3212683bdde92d0d9cb940618de2e`. Next 39926 and Vite 21457 were restarted from D's worktree on actual Node 24.21.0. The measured change is the rendered effective input, not merely a version endpoint.

Evidence: `.acceptances/hooks-d-cold-card-r7/assets/`. `served.json`, `result.json`, `reasoning.md` and `execution.md` describe the scope. Synthetic assistant tool input was seeded through the existing real execAgent harness; no model-generated tool call or successful provider inference is claimed. The Web actions, server continuation, HTTP receiver, PostgreSQL/Redis and CLI device execution are real. This is the OSS legacy fallback, not Cloud generic Review/token acceptance.

## Same persisted record: cold B projection verified

The original unapproved record from r1 was loaded in a fresh browser session without rewriting its database rows. `cold-card-effective-B-tall.png` visibly shows requested path **B.txt** and content **D effective revision B**. The screenshot was opened and inspected. `db-before.jsonl` shows the assistant still stores original A, while the associated tool row retains B and the immutable original snapshot. The tool/card native and parent association is unchanged.

The initial 1280×720 capture shows B's requested path but its content preview is covered by the approval controls; it does not prove visible content. The 1440×1000 capture shows the complete preview and controls. This is not a claim that every viewport has correct layout.

## Missing source-state recovery: newly observed failure

Submitting B on that old record created `op_1790599321294_agt_LVQt4a0dld6s_tpc_9Gb7bMxkoYY8_gGhww7S3`. Although its receiver was running and configured to return C, there were **zero HTTP requests**. The new operation has zero host hooks, and the same tool row parked again with original A, approvalArgs B and the old B context. B/C files remained absent. D stopped clicking this record and preserved it for the owner.

The old operation was created at 10:36 UTC; Submit occurred around 12:42 UTC. Its original captured state had 17 hooks; its Redis source state was absent when investigated. AgentStateManager's default TTL is two hours. This supports source expiry as the cause, but the absence was measured after Submit, so owner verification remains explicit. `startOperation.ts` loads a nullable source and resolves missing serialized hooks to an empty array. The runtime silently proceeding without hooks is reported to C2/coordinator; this path is **not passed** and the cold projection fix does not close it.

Evidence: `db-after-first-submit.json`, `resumed-state-summary.json`, empty `reapproval-receiver.jsonl`, `first-submit-unexpected-A.png`, `expired-source-submit.mp4` and its original frames. First/action/settled frames were opened. The clip intentionally ends on the unexpected A card, documenting the failure.

## Fresh source: B approval reparks C, then device writes C

A separate real operation, `op_1790599589056_agt_ogEKMcreWnbW_tpc_IseK56GH8pSF_sFke3YSY`, had 17 durable hooks and Redis TTL 7179 seconds before the Web action (`fresh-source-state.json`). The original assistant/native tool call was explicitly seeded, and the receiver initially rewrote it to B.

1. Cold-loaded B card shows the correct requested path and content. The first navigation initially remained empty; reload resolved it. The two empty screenshots are excluded from successful evidence.
2. The HTTP fixture was switched to C, then the actual Web Submit approved visible B. Controls ran again from original A. The same tool row/native ID persisted C with approvalArgs B and immutable originalArgs A; it returned to pending. B and C files were absent at this point.
3. The UI displayed C immediately and after a cold reload. `fresh-repark-C.png` and `fresh-repark-C-cold.png` were opened and inspected.
4. Submitting visible C reran controls, then the actual connected D device wrote **C.txt = D effective revision C**. B stayed absent. Exactly one afterToolCall records success=true and mocked=false with C arguments. The raw assistant still stores A. The tool intervention is approved.
5. Subsequent model execution failed with InvalidProviderAPIKey. The inspected terminal screenshot shows the API-key prompt alongside the edited C file. This verifies the failure display, not a successful parent-model response or next-provider payload.

Artifacts: `fresh-after-submit.json`, `fresh-db-final.jsonl`, `fresh-http-summary.json`, `fresh-receiver.jsonl`, `device-files.json`, `fresh-B-cold.png`, the C screenshots and `fresh-approved-C-provider-error.png`. `fresh-B-to-C-repark.mp4` and `fresh-C-approve-device.mp4` preserve temporal transitions; first/action/settled frames were inspected. Approval notifications correspond to the two actual decisions; no Stop notification was observed. The receiver saw three control calls (initial preparation and two approvals), each starting from original A. No Cloud token/partial/mixed-batch claim is made.

## Quality and teardown

D's six changed paths pass **71 tests / lint clean**. Full type base/current both have **1444 diagnostics with byte-identical diagnostic text**, so the combined check exits 1; this is not C2's 72-test/type-clean environment result. Commands, revisions and complete logs are in quality-provenance.json, base.json, check.log, types-base.log and type-comparison.json.

The first fresh harness launch used an inappropriate react-server condition and failed at react.createContext before creating an operation. The unchanged plain-Bun launch then succeeded; both logs are retained. No product code or dependency installation was used to bypass the failure.

The app was stopped with the owner-verifying helper. Both D gateways, CLI device connection, QStash and two receivers were stopped after checking process cwd/command; the named browser was closed. All eight relevant ports were empty at teardown. D PostgreSQL/Redis and records remain available. `teardown.json` records ownership and shutdown.

The source-state recovery defect, Cloud compatibility, successful model/next-context, managed QStash and final independent review remain open. No final acceptance URL, ready transition or public documentation release is claimed.
