# Submitted critical Stop retry repair — bounded D verification

Latest integration update: C2 de4148cdc4 (including C1 7a6dd20f) is present in D base 8637eb393b08, together with S 76707138/K/L. Its two-file isolation supplement changes only tests; the recorded r4 execution and its SHA below are unchanged. The consolidated owner-fixture check now passes 1267 tests/lint; types remain 1444/1444 with identical diagnostics. See owner-regression-checkpoint.md for exact quality provenance and the remaining card, Cloud and independent-review gates.

Temporary integration-base `cad39cb803a8dfd5830130fd58dc2c2038271609` includes C2 `8f4d8488c72455679ee78e52154de7e450cfae4b`, S/K/latest L, without conflicts. Docs merge `e90c22d0b633997aa5d5f8cdc4c3dbc21aa3ae85` was executed. The C1 7a6dd20f mock repair is still absent; final integration/served SHA and coordinator's final independent repair review remain pending. This supersedes the previous “fix not submitted” status, not the remaining review/Cloud gates.

## H10 / D04 / D06 sequence and observations

`.acceptances/hooks-d-stop-retry-r4/driver.ts` creates real operations through execAgent, persists explicit synthetic assistant tool input, and lets the real runtime park a manual out-of-directory write. It then invokes AiAgentService.stopPendingApproval against the real PostgreSQL and Redis. The resolution request ID is synthetic; **there is no real Cloud token claim or Web action in this supplement**. The HTTP receiver is real, and the original controller, model, dispatcher and runtime methods run unchanged. Observation wrappers call through and count execution. No direct model claim is substituted for Cloud behavior.

| Sequence                                                                 | Actual result                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Critical first HTTP 503                                                  | CriticalHookDeliveryError; interrupted status and pending batch marker persist; tool row aborted |
| Same resolution request, still 503                                       | CriticalHookDeliveryError again, never success; marker retained; second actual HTTP receipt      |
| Receiver changed to 200, same request with fresh AiAgentService instance | Success; marker consumed by real scoped DB update; third receipt                                 |
| Successful replay                                                        | Success; no fourth receipt                                                                       |
| Ordinary first 503                                                       | Best-effort success; marker consumed; one receipt                                                |
| Ordinary replay                                                          | Success; no second receipt                                                                       |

Both operations stay interrupted. During each Stop/retry series the call-through observers record createOperation=0, executeStep=0, executeTool=0, interruptOperation=1. Tool rows remain aborted and the intended file marker is absent. The process PID is unchanged; no continuation or worker restart is used. No device session was started for this negative service-boundary check; it is not a replacement for final device/UI verification. Notification replies deliberately carry deny/updatedInput and do not alter the result.

Evidence: `.acceptances/hooks-d-stop-retry-r4/assets/results.json`, `receiver.jsonl` and `driver.log`, with operation/native IDs, per-attempt durable marker/state, receipt counts and method counts. The first fixture driver incorrectly assumed initial state.messages was populated; its pre-execution TypeError log is retained separately and excluded from successful evidence. No product behavior was repaired to make the driver pass.

The test process is **Bun 1.4.2**; its process.version compatibility value is v26.3.0, not evidence that Node executed it. Quality commands select D's actual Node 24.21.0 through ASDF. No Next/Web process was served in this supplement.

## Remaining final-product checks

Through the real generic Review UI/action path, repeat the critical 503 → same-request 503 failure → 200 success → no-send replay sequence with the actual resolution identity, plus ordinary 503/no-send replay. Observe the correct card, full mixed/partial native set, no new continuation/worker/tool effect, durable interrupted state and parent reply. This remains blocked by the Cloud environment; the synthetic identity above cannot satisfy it.

Also exercise pending-marker retry with unavailable runtime state and a failed marker-consumption save: each must error, not silently succeed; delivery before failed consumption may repeat. Verify owner/batch/status isolation, failed interrupt/terminal save sends no notice, and concurrent retry duplication limits. These are covered by the owner automated regressions but not newly injected into D's real service environment here. Final independent review has not been consumed.

## Quality and reliability contract

D ran check --lint --test --type on InterventionController.ts, execAgent.resumeApproval.test.ts, agentOperation.ts and agentOperation.test.ts: **78 tests passed / lint clean; full type failed**. New-base/current type diagnostic text is byte-identical at 1444/1444 in D's unchanged isolated dependency graph. Logs: types-base.log, check.log, type-comparison.json. No unrelated Drizzle fix or install occurred.

The new operation marker is persisted with terminal state and consumed only after dispatch returns. Critical errors retain it; ordinary swallowed errors consume it. Retry loads the original host hooks and stays stopped. Delivery-before-consumption failure or concurrent requests can duplicate; there is no delivery lease, background Stop retry, outbox or exactly-once guarantee. Older terminal rows without a marker do not synthesize a notification; the separate legacy direct handler retains its old crash-loss boundary. The bilingual drafts now distinguish these paths.
