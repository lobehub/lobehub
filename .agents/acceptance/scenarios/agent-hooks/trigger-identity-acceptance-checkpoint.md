# r27: Isolated trigger-identity acceptance checkpoint

This is a separate identity-feature composition, not a merge of that feature into its PR target. Original integration-base remains `647ab2bb3cb73ff0542a082bb499fde2354d3228`. D composed fixed L `8b62d3b80b00358f43dadcf6a5e26dc5e42f1047` on that base in `feat/agent-hook-trigger-user-acceptance`, producing `c26456e618017a1fe8b923dce30c67e1d2738864` without conflicts. Its complete tree `04a81d12e9b227ffb9efbc25e5675f890705e40a` matches L's tested tree. The 19-file identity diff is absent from integration-base and the docs PR's product diff. F explicit-target is not included.

## Real execution and bounds

D reused private Cloud `69c38102` and switched only its nested OSS to `c26456e6`; Next39927, local QStash58080 and receiver58096 served this round. Node24.21.0/Bun1.4.2, no install. The backend-only evidence surface proves payload/ownership outcomes; no new UI result is claimed.

The fixture creates a real owner agent and link share using AgentShareModel, resolves its grants through `findByShareIdWithAccessCheck` for a second synthetic user, and calls real `execAgent({hooks,shareGate})`. The product constructs trusted principal; the driver does not manufacture it. The public shareChat HTTP router does not expose hooks registration. This is therefore **server-programmatic entry evidence, not authenticated public shareChat/Web UI acceptance**. Explicit `llm_result` seeds are disclosed; calculator execution is real, subsequent provider inference fails for missing valid credentials.

| Observed boundary                      | Evidence                                                                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner without visitor, local and queue | Calculator returns21; beforeStep/beforeToolCall/afterToolCall/afterStep/onComplete/onError payload userId is owner.                                                                     |
| Share visitor, local and queue         | Same calculation returns21, the six event types carry visitor; forged userId inside tool arguments does not affect payload identity.                                                    |
| Persistence and worker account         | All operation/topic/message/tool userId values remain owner. Visitor topic.senderId and streamOwnerUserId identify visitor; queue metadata.userId and state.origin.userId remain owner. |
| Actual local queue boundary            | Signed local QStash delivery reaches the real /api/agent/run in a separate Next worker, which reloads Redis state. This is not managed-cloud QStash.                                    |
| Share restrictions                     | Requested manual mode becomes headless; device access stays false. Seeded writeFile and valid callSubAgent are blocked, no file or child operation, no human/child producer invocation. |

Six valid fixtures satisfy `assert-results.py`. An initial extra fixture mistakenly used non-product `callAgent`; its raw record is retained and excluded from child-permission proof. The corrected independent fixture uses `callSubAgent`. Before/after-tool identities and reachable lifecycle identities are supported; onToolCallError was not emitted in this round, no “all16 product pass” is claimed.

Not executed: remaining human/subagent/compact/tool-error HTTP identity outcomes, new-identity continuation/repark, public authenticated shareChat UI/API registration chain, successful model/parent replies, new-identity bot/subagent callback product round, and managed QStash. Human/subagent visitor producer regressions are only automated quality evidence, not permission to approve or launch children from share UI. No policy was relaxed.

## Quality and provenance

D's 19 explicit changed paths: **464 tests/lint passed; full type failed**. Compared with the immediately preceding r26 base647 log on the unchanged graph, currentc264 remains1444 diagnostics; raw diagnostic text differs in locations, complete text matches after line/column normalization. The baseline log is reused, not claimed as a fresh run. L234/C2type-clean environments are not imported. Temporary driver/receiver lint was corrected and passed; actual executed copies remain separately preserved.

Raw round: `.acceptances/hooks-d-trigger-identity-r27/`. `plan.json` and `report.md` describe methods and limits; assets include `events.jsonl`, `observations.json`, `db-snapshot.json`, `redis-snapshot.json`, `worker-http.txt`, `source-versions.json`, `provenance.json`, `type-comparison.json`, `check.log`, executed script copies and SHA256 manifest. Logs marked private are excluded from publication.

Teardown verified no listeners on39927/58080/58081/58096; only this round's owned processes were stopped, no browser was started, DB/Redis and synthetic records are retained. Old r7/r17/r20/r21/r23 evidence retains its original SHA and does not prove this new identity contract. The original31 ledger is unchanged. No code review or final acceptance checker was invoked; no passing acceptance URL is published. Remote push is still unconfirmed because of the separate Lody broker failure.
