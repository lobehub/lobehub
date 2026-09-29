# D: Hook integration and acceptance work in progress

Current policy successor: [r34 database-owned email lookup](db-email-policy-checkpoint.md). Integration target `c1a8e81f7449f03b5987aeb7fbbd70a5bf49e5cc` includes C2 `12baf5ab`; Hook email enrichment has no query timer. r28/r29/r33 remain historical at their original served SHAs, including the old timeout positive control, and do not verify this new waiting policy. No product replay or email-timeout test was run; C07 remains partial.

Separate identity follow-up: [r27 bounded identity execution](trigger-identity-acceptance-checkpoint.md) uses acceptance-only branch `c26456e6`; its L identity source is **not** in this PR target. Six reachable Hook types have local/queue HTTP and owner-persistence evidence, with explicit programmatic/seeded boundaries; remaining identity paths are unverified. The original31 ledger and served SHAs are unchanged.

Current r23: [real Cloud conversation Web](cloud-web-checkpoint.md) now covers single and partial-batch B→C reapproval through actual buttons, including rejection reason, retained pending sibling and no reexecution. Agent Gateway plus normal reload makes pending cards reachable; old skeleton observations are not a blanket UI block. Stop stale controls/false Edited, standalone token-page routing and model/managed-QStash gaps remain. [Current 31-item ledger](current-results.md) supersedes historical status summaries without changing their evidence SHA. Final checker remains unused.

Latest r22: [custom contract and mixed Stop](cloud-custom-checkpoint.md) confirms that the real Marketplace producer does **not advertise cancel\_interaction**; the actual token request returns400 with unchanged DB/no claim. This is an unavailable action, not custom-handler retry coverage. Its supported mixed custom+binary Stop returns500→500→200→replay with receipts1→2→3→3, both members cancelled and no effects. Pending/final UI limits remain explicit.

Cloud-dependent blocked subcases and the minimal real entry are listed in [cloud-blocked-subcases.md](cloud-blocked-subcases.md). OSS evidence is retained separately; no generic token/UI pass is inferred from the compatibility fallback.

The r33 integration-base was `6b492211582e19df5cebca45e41ab09fd24df576`, containing C2's persisted cancellation checks. L identity remains separate; r33 executed acceptance1f49 (same tree as L25031). [r33](cancel-fix-checkpoint.md) records six bounded real Redis/HTTP observations and target546/acceptance549 tests plus lint; full type still1444. PR #20137 remains draft. Historical r28/r29 stay at f5ad and r23 stays Cloud69c/OSSab5; the new report does not relabel those executions.

Current r20/r21 supplement: [real token Stop](cloud-token-checkpoint.md) verifies actual notification-token critical retry (500→500→200→replay, HTTP receipts 1→2→3→3). [Partial Review](cloud-partial-checkpoint.md) verifies authenticated token claims, actual local queue workers, B→C repark with pending sibling retained, old-token terminal no-ops, stale-revision 409, reject/approve/Stop IDs and no tool side effects. Both served private Cloud `69c38102` + OSS `ab5d35a6d7`. The actual token Web URL is an unknown route; pending chat remained a skeleton and final cancelled/rejected tools still show false Edited/+1. These API results are not complete UI or inference passes. Current quality is **1444 base / 1444 current** type diagnostics, still failed; full text matches after line/column normalization. The five new test diagnostics were removed by C2 32d0c692; its complete router file has 39 tests/lint passed.

Reusable previous evidence includes [cold B/fresh B→C device flow](cold-card-checkpoint.md), [missing-source early rejection](missing-source-checkpoint.md), [ready continuation reuse](ready-reuse-checkpoint.md), and [transient source-read recovery](source-read-failure-checkpoint.md). Preserve each execution SHA and seeded-provider boundary. Earlier [fixed implementation checks](fixed-integration-checkpoint.md) and [owner reconciliation](owner-regression-checkpoint.md) remain historical quality evidence, not the current type result.

[Independent review scope and CI correction](review-scope-checkpoint.md): the sole light follow-up at `5b762f88`/C2 `3fc72ae6` marked original P1/P2 resolved by static inspection only; no tests or D raw evidence were independently executed/reviewed. Later Cloud router repairs are outside that fixed review. The allocation is exhausted; no automatic new review pass is inferred. The one final acceptance evidence check remains unused. Test model and managed QStash configuration are still missing. The initial phase-1 instructions below describe preparation provenance, not today's integrated feature support.

## Files and finishing criteria

- `plan.json`: 31 stable user-outcome criteria, using Acceptance's existing `plan[]` schema. No test/lint/type gate masquerades as acceptance.
- `mapping.md`: requirement mapping, fixtures, observations, and evidence rules.
- `approval-repark.md`: partial-batch reapproval, pending siblings and stale/concurrent card actions; exact C2 binding pending.
- `c1-interface.md`: pinned C1 interface observations, harness binding design and temporary unsupported-response boundary; no C1 integration or execution.
- `c2-interface.md`: pinned submitted C2 persistence/Cloud/notification contracts; full integration and product verification pending.
- `receiver.ts`, `responses.ts`, `harness.ts`: temporary HTTP fixtures and the real server `execAgent({ hooks })` entry seam. No product configuration endpoint.
- `self-check.ts`: verifies fixture server behavior only; does not exercise LobeHub.
- `protocol.{en,zh-CN}.draft.md`: unpublished bilingual drafts, eventual location `docs/development/basic/agent-runtime-hooks{,.zh-CN}.mdx` after final verification.
- `environment.md`: observed prerequisites and exact remaining gaps.
- `environment-step2.md`: latest infrastructure results, dedicated gateway/device identity, service commands and remaining model/managed-QStash requirements.
- `dependency-incident.md`: preserved incident timing/error/path evidence, D-owned QStash binary and future installation/cache boundaries.
- `.acceptances/hooks-d-phase1/`: ignored preflight output and checker notes. Final product runs get a separate immutable round directory.

Phase 1 is complete when the checker findings are resolved, fixture smoke works, environment gaps have evidence and commands, and coordinator receives the paths. No product pass, final report ingestion, branch integration, or public PR in this phase.

## Run fixture smoke now

From this worktree root:

```bash
bun .agents/acceptance/scenarios/agent-hooks/self-check.ts
HOOK_RECEIVER_LOG="$PWD/.acceptances/hooks-d-phase1/assets/manual-receiver-1.jsonl" \
  bun .agents/acceptance/scenarios/agent-hooks/receiver.ts
```

Receiver binds loopback to an OS-allocated port and prints its URL. Each log path must be new (exclusive creation). `GET /health` proves the process responds; `POST /hooks/<fixture>` receives notifications or serves the selected control response. Stop this process with Ctrl-C. Never terminate a shared listener. Use only synthetic arguments/content; field redaction cannot detect secrets embedded in free text. Review all logs before publication. No request headers are written. Fixture query/path names are harness routing, not extra protocol fields.

`rewrite` currently returns `{path:'fixture/effective.txt'}` as the **whole** new tool input. Seed a compatible `d-fixture` tool before using it. Adjust fixture input to the actual final tool schema, not product code. `late-allow` waits 1200 ms; the default harness control timeout is 200 ms. For C07 set JSON `"scenario":"late-allow","timeout":5`, wait for receiver arrival, press Stop before 1200 ms and retain observation beyond that time. Compare with the same 5-second timeout and no Stop. This separates cancellation from timeout. Set `"notificationResponse":"deny"` to prove notifications ignore control-shaped responses. `size-boundary` and `oversized` are otherwise-valid JSON responses of exactly 65536/65537 UTF-8 bytes; distinguish the size-specific error from malformed JSON.

## Final runtime entry (wait for final base and actual provider/device prerequisites)

`harness.ts` calls the actual `AiAgentService.execAgent`; it does not replace the Runtime or dispatcher. A minimal JSON input, in an ignored directory, is:

```json
{
  "onError": "block",
  "params": { "agentId": "<seeded-agent>", "prompt": "Use the synthetic d-fixture tool once" },
  "receiver": "http://127.0.0.1:<printed-port>",
  "scenario": "deny",
  "userId": "<seeded-local-user>"
}
```

Run in an isolated environment loaded through the existing adapter; never point a production login at localhost or vice versa:

```bash
(
  unset LOBEHUB_JWT LOBEHUB_CLI_API_KEY LOBE_API_KEY LOBEHUB_WORKSPACE_ID
  source .records/env/hooks-d-isolation.env
  eval "$(.agents/acceptance/scripts/init-dev-env.sh env)"
  AGENT_RUNTIME_MODE=local bun .agents/acceptance/scenarios/agent-hooks/harness.ts .acceptances/hooks-d-phase1/run.json
)
```

Repeat with `AGENT_RUNTIME_MODE=queue` and a healthy QStash + real callback worker. `delivery:'qstash'` selects QStash **notifications**; controls always fetch. The harness returns after `execAgent` returns, not after completion. Observe the returned run through receiver/persisted state and real Web UI. It deliberately does not print `ExecAgentResult`, which may carry a gateway token. The final driver needs bounded state observation for completion and must preserve its local runtime process until terminal state; this is an entry harness, not an autonomous acceptance runner.

For worker replacement use two owned app processes sharing only the isolated test DB/Redis, and a recorded queue barrier. Do not simulate the worker swap with a second dispatcher in one process. Do not use the production debug proxy to claim backend branch coverage.

The continued preflight has now prepared D-owned dependencies, migrated Postgres/Redis, local QStash and S3, and a seeded CLI login. See `environment-ready.md` for current state and restart commands. This does not enable final Hook execution before the coordinator supplies the integrated base. The initial missing-eslint checkpoint remains historical; focused lint now passes.

## Execution order and publication gate

1. Record the coordinator's final SHA and dependency heads; verify ancestry and relevant diff. Read C1/C2 final interfaces and update fixture bindings. Prove served code by process cwd/build marker and an observable changed hook field.
2. Resolve environment gaps below, seed synthetic user/Agent/tool, and prove side-effect instrumentation with an allowed positive control. Fault probes require an observed hit and an unmodified comparison.
3. Run H01–H16 in local/queue with actual HTTP as applicable, then C01–C07 and D01–D08. Keep failures local, repair with responsible owner, rerun affected outcomes. Type failures require same-environment baseline/current diagnostics and changed-file delta, not automatic abandonment or false pass.
4. Capture real Web approval/tool cards and parent replies, cold reload persistence, and cancellation video. Inspect every image/video; text/database checks cannot replace required visual media.
5. Prepare Acceptance `result.json` with one result per plan id; attach separate reasoning and raw records with nonempty descriptions. Unavailable device/LLM/QStash/UI cases remain blocked/uncertain. Reuse valid upstream evidence with original provenance only.
6. Reuse the same acceptance-checker for exactly one evidence review before ingestion (plan feedback at most two). Publish only after the agreed evidence coverage gate, with the actual CLI-returned URL. Phase 1 performs none of this publication.

- [Real Cloud source Review checkpoint](cloud-review-checkpoint.md): r14 ordinary Stop/replay, generic critical Stop failure, exact private Cloud/OSS combination and UI limits.

- [Ready continuation reuse](ready-reuse-checkpoint.md): real Cloud source retry after older-source expiry, own persisted hooks/ledger unchanged, scheduling-only boundary.

- [Source read failure and recovery](source-read-failure-checkpoint.md): scoped Redis fault, actual Cloud API rejection and same-request recovery, with precise claim boundaries.

- [r28 isolated trusted owner/email delivery](owner-email-checkpoint.md): five real local/queue fixtures; identity product source stays on the separate acceptance branch, historical17 owner-fixture failures are resolved by r31 (263 tests/lint); full type still fails; historical r29 failure has a separate bounded r33 follow-up.

- [r29 email-wait cancellation failure](email-cancel-checkpoint.md): acknowledged interruption followed by two control HTTP requests and persisted calculator42; linked to existing C07, historical failure preserved; C2 repair and r33 follow-up are separate.

- [r33 persisted cancellation repair](cancel-fix-checkpoint.md): real Redis/HTTP, distinct interruption process, controls-between and observation-before-launch cases; no queue-callback/Web claim or final checker.
