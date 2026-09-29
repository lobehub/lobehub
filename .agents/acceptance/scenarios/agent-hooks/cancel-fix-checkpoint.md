# r33: Persisted cancellation checks on the fixed owner/email composition

## Version and scope

Published original target `6b492211582e19df5cebca45e41ab09fd24df576` is e1 plus fixed C2 `5bbb9a4045a122b8b363f1875b92c08e80f2e89a`, without L identity code; its tree is fe735be033005c815d75b97f21dfbd7c57a6de90. Docs inherited it at b1aabe044577e1d454e9e56512464e019c379161. Independent acceptance `1f49afd46f38a60153ce5d48bbd0300bb540d8c5` has the exact complete tree of fixed L25031e0e:194445d40f9439eae8c5fd8f758c5e9f8502142c. Private Cloud69c38102's nested OSS was pinned to that acceptance SHA. All merges were conflict-free; no D production/test patch or package installation.

This is a programmatic real execAgent + seeded llm\_result + actual executeStep/server calculator/HTTP/Postgres/Redis path. AGENT\_RUNTIME\_MODE=queue selects the real Redis coordinator, but the standalone worker explicitly uses queueService:null and directly calls executeStep. It is **not** a QStash-triggered worker, a Web Stop route, client/device execution or successful inference. The public share UI does not accept hooks; real DB-created/access-checked shareGate remains headless and does not grant device/subagent privileges.

Shell Node is24.21.0, Bun1.4.2. Bun reports process.version=v26.3.0 inside the worker; this compatibility value is recorded separately, not relabeled as shell Node. Root runtime/database packages and the Cloud nested source resolve to D's isolated checkouts. No shared dependencies changed.

## Six fresh bounded observations

| Fixture                                                         | Real HTTP requests                                                 | Persisted outcome                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Email wait, same process, onError:block                         | 0                                                                  | interrupted; tool intervention aborted, no42                              |
| Email wait, same process, onError:continue                      | 0                                                                  | interrupted; tool intervention aborted, no42                              |
| Email wait, independent interruption process                    | 0                                                                  | ACKtrue, Redis sentinel1; aborted tool, no42                              |
| Stop while first control response is held                       | Only the already-in-flight rewrite request                         | No second control after ACK; original7\*3 tool aborted                    |
| Stop while ordinary beforeToolCall observation response is held | Two controls and one already-in-flight observation, all before ACK | Effective6\*7 tool aborted before calculator result; no42                 |
| Same email delay without stop                                   | Two controls                                                       | Actual calculator42; original7*3/effective6*7/additionalContext preserved |

Five cancellation steps finish in200–1235ms, before the first unchanged2second poll. The independent interrupter PIDs differ from executeStep PIDs and directly invoke real interruptOperation using the same Redis store; their ACK files record sentinel EXISTS=1. Every cancelled operation is interrupted in DB and Redis; all tool rows retain owner user\_agent\_testing\_001 and have aborted intervention, STOPPED\_TOOL\_CONTENT, no result42 and no success state. Receiver timestamps show **zero new HTTP requests after each ACK**. Already-in-flight requests are expressly not claimed to be recalled. Positive control omits email on the unchanged1second bound and preserves effective/original/context snapshots. Its one executed step is runtime idle/DB running with no following step scheduled; it is not a completed model run.

Faults are explicit: the production Cloud-alias UserModel actually reads DB emails, then the driver holds the real result for2.5s. Network cases hold a real receiver response until the independent stop is acknowledged. No AbortController is shared or directly aborted by the driver, no cancellation sentinel is fabricated, and no HTTP response is mocked. The before-launch case exercises the checkpoint after ordinary observation, not every later visibility/device/client await or the residual check-to-launch race. No independent runtime-call counter was installed: negative execution evidence is the production cancelled path, actual receiver log and durable aborted tool state, alongside a positive real calculator result.

## Excluded setup

The initial six fresh setup fixtures mistakenly selected AGENT\_RUNTIME\_MODE=local, which intentionally chooses InMemory state. Cross-process stop then returned false/sentinel0; a separate attempted visibility-query hold was not reached. That entire batch is excluded under assets/excluded-inmemory-setup, with its original driver/logs/rows retained. It is not cancellation or Redis success evidence. The valid six fixtures use new IDs, queue-mode Redis, explicit ACK/sentinel assertions, and the actual ordinary observation boundary. No old r28/r29 record was used or modified.

## Quality and retained limits

D reran15 explicit affected paths separately at target and acceptance: target546 tests, acceptance549 tests, lint clean. Counts overlap and are not added. Full type fails1444 at both heads. Acceptance's complete extracted diagnostic blocks equal r31's old acceptance; target's file/code multiset equals its old e1 baseline but two existing OIDC SQL union renderings differ, so target logs are not byte-equal. Source/dependencies/configuration were not changed to suppress diagnostics. Owner L777/C2546 green environments are separate evidence.

The old r29 remains failed historical evidence at f5ad. r33 now observes the affected backend correction with real Redis/HTTP, including different OS processes. C07 is only **partial**, not full acceptance: no fresh Web cancellation video, signed queue-callback cancellation, client/device launch, runtime-read-failure, approval/cache-recovery product matrix or atomic check-and-launch guarantee is established. Current partial coverage does not rewrite the historical failed report. Other r28 identity/email outcomes and C04/P1 evidence keep their original SHA. No reviewer/checker was called and no passing acceptance URL is published.

## Evidence and teardown

Immutable root `.acceptances/hooks-d-cancel-fix-r33/` holds plan/report and assets: source-versions.json, actual created/finished/interrupt ACK records, events.jsonl, DB/Redis snapshots, assertions.json, original executed scripts, target/acceptance check logs and diagnostic comparisons. Private process logs are excluded from publication; only synthetic identities are used. Six setup records are isolated from six valid observations. The local QStash emulator was available as the existing runtime prerequisite, but no QStash delivery proof is inferred from its presence.

Only D-owned QStash1364 and final receiver5452 were stopped after cwd/PID checks (initial receiver1368 had already been stopped). No58080/58081/58096 listeners remain. No Next/browser/device process started this round. In-process wrappers restored in finally; script processes exited, DB/Redis and all synthetic records are retained. Target/docs refs were published/read back; L was sent the exact new target for its own same-tree restack.
