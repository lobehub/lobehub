# D integrated execution checkpoint — 2026-09-28

Current r20/r21 supplement: [real token Stop](cloud-token-checkpoint.md) verifies actual notification-token critical retry (500→500→200→replay, HTTP receipts 1→2→3→3). [Partial Review](cloud-partial-checkpoint.md) verifies authenticated token claims, actual local queue workers, B→C repark with pending sibling retained, old-token terminal no-ops, stale-revision 409, reject/approve/Stop IDs and no tool side effects. Both served private Cloud `69c38102` + OSS `ab5d35a6d7`. The actual token Web URL is an unknown route; pending chat remained a skeleton and final cancelled/rejected tools still show false Edited/+1. These API results are not complete UI or inference passes.

Earlier dated supplements below retain their original SHA and then-current gaps; they do not override the r20/r21 scope above.

Current supplement: [r17 Cloud Stop route repair](cloud-stop-route-checkpoint.md), served integration `196787eedd`. Source critical retry and ordinary replay are observed; token/full UI are not. Current test-only successor is `ab5d35a6d7` (C2 32d0c692); D types are back to 1444/1444 with the five new diagnostics removed and full text equal after line/column normalization, still not a pass. Earlier sections and tables below are historical observations under their stated SHAs; superseding r12/r15/r16/r17 evidence is linked in the [current index](README.md). Independent code review is exhausted; final acceptance checker remains unused.

Latest notification-only supplement: [notification-checkpoint.md](notification-checkpoint.md), integration `a471e3876a3ecd25cb233108754e1be3f0ac2cc3`. The historical observations below retain their original SHA and open conditions.

This is an in-progress handoff, not an acceptance verdict or published report.

## Source and isolation

- Integration base: `858b2d4586fcd2b0cfea8b3f8b8757019e152a29`, pushed as `feat/agent-hook-integration-base`.
- Fixed ancestors: C2 `5299fed7`, S `a67a39c6`, K `5e3a2f73`, L `b9fda258`, plus C1/H/F/T carried by C2.
- The only merge conflict was imports in `packages/agent-runtime/src/types/hooks.ts`; retained both `CompactHookContext` and `AgentRunLineage`. No functionality was repaired in the merge.
- D preparation material retained by docs merge `880be311a37d1fa88c55c9e2fccf6388d4ad12f6`. Product tree matches the integration base.
- Immutable evidence directory: `.acceptances/hooks-d-integrated-r1/`. Raw private logs and broad state snapshots must be pruned/redacted before publication. They are not automatically eligible evidence attachments.

## Observations already collected

| Boundary                     | Actual observation                                                                                                                                              | Limit                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Real local/queue `execAgent` | HTTP step/error/completion notifications correlate with actual missing-provider failure                                                                         | No successful model inference; queue uses the local QStash service                            |
| Tool control/device          | Actual HTTP allow/deny/protocol fixtures feed real runtime and D CLI device; positive marker writes and negative no-write controls recorded                     | Tool calls are explicitly seeded assistant fixtures, not model output                         |
| Approval                     | `allow` still parks an out-of-working-directory write; real Web Submit dispatches to the D device                                                               | Parent reply cannot complete without model credentials                                        |
| Rewrite card                 | Persisted tool arguments and before-intervention event contain B, but the rendered approval card and parent assistant tool payload show A                       | Reported to C2; do not count as passed or approve the stale card                              |
| Critical lifecycle           | Actual HTTP 503 for done/onComplete, error/onComplete, error/onError propagates the same critical error; original durable terminal state/error remains          | Done input is seeded; error inputs exercise actual missing-key failure                        |
| Reload isolation             | Same service runs A then B; injected state-read failure/reload failure preserves B origin and thrown error identity; no-first-load C does not borrow A/B origin | Targeted state-read fault injection disclosed; not an actual Redis outage                     |
| Compression                  | Real long-input runtime invokes compression; normal vs delayed critical HTTP 503 retain the same missing-key compression failure and continuation phase         | Successful compression and next-model input remain unverified                                 |
| Child launch                 | Real isolated child DB/thread/queue launch returns while child is running, later errors; nonexistent child produces actual creation failure                     | Shared-group, sustained successful child and worker-recovery variants remain open             |
| Registration                 | Actual `execAgent` returns `success:false`/error for eight invalid configurations                                                                               | Initial driver wrongly equated rejection with throwing; use `registration-validation-v2.json` |
| Worker recovery              | Worker A killed only after receiving its actual HTTP barrier, verified D cwd; worker B started against the same D Redis/DB                                      | Worker B received replay after natural lease expiry; no lock/store was deleted                |

## Quality and blockers

- D fixed dependency graph full type base/current: 1444 diagnostics, byte-identical. This is **not a type pass**. Duplicate Drizzle versions are a major cause; no C2 environment result is substituted.
- Initial integrated F-to-base check had three RuntimeExecutors fixture failures and twelve S HTTP-fixture failures. D subsequently adapted two test files to the integrated contract: the same 63-file check now has 1103 tests passed / lint clean. The original red log and corrected log are retained; these tests do not replace actual HTTP product evidence. See `execution-checkpoint.md`.
- D receiver changes pass scoped lint and harness self-check (14 response fixtures, 16 hook factories, disconnect/redaction).
- The available independent Cloud checkout `4b2a3272` with nested OSS `858b2d45` has its own D package/cache/store/state directories and cloud database. `/signin` fails compilation because its business-const overlay lacks `DEFAULT_ASR_MODEL`. No shared checkout was modified. Generic review/token paths remain blocked on a compatible Cloud overlay.
- Static Cloud `deliveryV2 -> defaultDeliveryV2 -> createBatchWithSupersession` forwards the whole `supersedes` object. This is not runtime proof.
- Real model credentials and managed QStash access remain unavailable. The coordinator owns the outstanding provider-location question.
- The same acceptance-checker has one final evidence review remaining. No final acceptance URL or passing report has been published.

## Stop request isolation supplement

C2 `64b9424b932aa9953ff3571d467fd136b3b2ccae` is merged without conflicts into the existing D integration-base `03282d19a248aef0b8899e3eedce52f23edea272`, retaining C1 7a6dd20f, S 76707138, K 5e3a2f73 and L b9fda258. Relative to C2 608593a3, only two test files change (+68 lines); production behavior is unchanged. D read the exact diff and `/tmp/lobehub-hook-c2-stop-isolation-check.log`: C2 reports 80 tests / lint / full type clean in its own snapshot, not D's environment.

The assertions reject different or missing resolution IDs, wrong batch IDs and incomplete Stop member sets in both pending and consumed states, without delivery, claim, completion or marker changes. Database assertions reject foreign-owner or terminal completion without partially writing a marker, and reject marker consumption when status is not interrupted. D's r4 real HTTP/DB observations keep their original executed SHA and bounded synthetic-resolution provenance. These extra assertions do not establish the missing generic Review UI path or close P1's independent review.

No product service was restarted for this test-only update. D's consolidated limited regression and same-environment type comparison remain pending reconciliation of the owner's RuntimeExecutors fixture repair. The handoff file now mentions later card/fixture commits and the remote PR has advanced; those versions are not silently substituted for this explicitly pinned integration. Current Cloud SPA compilation, real model configuration and managed QStash gaps remain open. No final acceptance URL or ready transition is claimed.

## Owner RuntimeExecutors fixture delivered and D regression completed

C2 de4148cdc4 is now merged into D integration-base 8637eb393b085f2c96d4e9be415ac86f0519c4dc. Its one test-file delta supersedes D's earlier fixture adaptation; the docs merge retained the complete owner file, with explicit atomic preparation and parent/native-ID guards. Apps/server and packages now have zero D delta against base. S's owner fixture was already included.

D's consolidated 71-path check passes 1267 tests and lint. Base/current full type both have 1444 diagnostics with byte-identical text; types remain failed. 15,652 package-manifest/hash/inode records are unchanged. See [owner-regression-checkpoint.md](owner-regression-checkpoint.md) for exact provenance and limits. This supersedes earlier fixture-pending and consolidated-check-pending statements, not the open card, Cloud, model, managed-QStash or independent-review gates. No product service or prior acceptance case was restarted.

## Cold-card owner correction and real Web follow-up

C2 507b37f9 is merged without conflicts into existing D base 81591e7112181cf29d0564af726ed6946a4acee1; actual served docs95d4056feaf3212683bdde92d0d9cb940618de2e was restarted and observed. Same old persisted card now cold-renders B with original assistant A retained. A fresh valid-source operation went through actual Web B approval → controls C → repark → cold C card → C approval → actual D device C write, while B stayed absent; the later model returned missing-key error. This supersedes the earlier cold-projection failure only for the observed paths.

The old source was beyond its two-hour state TTL: its Submit created a hooks-free continuation, made no HTTP request and reparked original A. This separate recovery failure was sent to C2/coordinator and remains open. Six changed files pass 71 tests/lint in D; types1444/1444 remain identical and failed. Details and immutable artifacts are in [cold-card-checkpoint.md](cold-card-checkpoint.md). No generic Cloud Review, successful LLM, managed QStash, independent-review closure or full acceptance is claimed.

## Complete fixed-diff check and scope correction

Requested 507b/S767/K5e3/Lb9 ancestors and pushed base81591e711218 were rechecked. Docs8e31211ffe is clean and has no product/test delta. The latest 73-path check passes 1301 tests/lint; full type remains1444/1444 byte-identical. Range audit found eleven F-initial-only files excluded by the previous F66-parent starting point. Their supplemental check passes357 tests/lint, so the two explicit lists cover all84 changed paths from dc64d76955 (before F e51) to current base. Counts are per command, not summed unique tests. The original15 fixture failures do not recur. See [fixed-integration-checkpoint.md](fixed-integration-checkpoint.md) for exact commands and preserved evidence. Product/review gaps, especially missing-source hooks loss, remain open.

## C04 recovered cold-card assertion supplement

C2 b2e90a1325024eab9328b8cbc1c53947a6c3d769 is merged without conflicts into the same D base1b9106f1982937214da7d7dda9ce6e81e443e716 and then docs a5c9659de48e6d3408c0b99b38cdb28ec0842118. D verified the sole delta from507b: 44 lines in toolControlPipeline.test.ts. Single/batch recovered approvals assert old visible effective input, rewritten new pending input, the same row/native ID, originalArgs preservation and approvalArgs retaining the reviewed input; existing no-execution assertions remain. Production code is unchanged.

D reran that owning file: 36 tests passed / lint clean. New-base/current full type both report1444 diagnostics with identical diagnostic text (failed, combined exit1). Evidence is `.acceptances/hooks-d-c04-assertions-r9/assets/{provenance.json,types-base.log,check.log,comparison.json}`. This supplements, rather than relabels, the complete84-path r8 checks and actual r7 UI/device evidence. The same old paused record's coldB proof already exists in r7; no new product run or final review was triggered. Missing-source hooks loss, provider/Cloud/managed-QStash gaps remain open.
