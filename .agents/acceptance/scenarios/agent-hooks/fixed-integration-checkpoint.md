# Fixed 507b integration: complete diff quality scope

Latest test-only supplement: C2 b2e90a13 is present in integration-base1b9106f19829. D adds a scoped36-test/lint pass, with new-base/current types1444/1444 identical and still failed (r9). Production and the84-path scope are unchanged; all r8 execution revisions below remain historical.

The exact requested set is present and pushed in D integration-base `81591e7112181cf29d0564af726ed6946a4acee1`: C2 507b37f9, C1 7a6dd20f through C2, S 76707138, K 5e3a2f73 and L b9fda258. D rechecked each ancestor and both remote branch tips. The checked docs revision is `8e31211ffeafbae9fa89370902b5d3514414c591`; the r7 product was actually served at `95d4056feaf3212683bdde92d0d9cb940618de2e`, before the documentation-only checkpoint. No new app run is implied by this check.

Both 507b merges were conflict-free. Earlier, the de414 docs merge conflicted only with D's temporary RuntimeExecutors fixture; it was resolved to the complete owner file. There is no apps/server or packages delta between D docs and its base.

## Complete scope and results

The full fixed implementation range starts before F's initial e51bbddce0 delivery: `dc64d76955...81591e7112181cf29d0564af726ed6946a4acee1`, **84 changed paths**. Earlier D limited-check ranges started at e51 (the parent of F's final matcher correction), so they omitted eleven files changed only in F's initial delivery. Their recorded results remain valid for their explicit lists, but are not the entire F-to-final diff. This checkpoint corrects that coverage gap.

| Command scope                                                     | Result                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------- |
| 73 paths from `66af6210^...integration-base`, lint/test/type      | 1301 tests passed; lint clean; full type failed            |
| Remaining 11 F-initial paths, lint/test                           | 357 tests passed; lint clean                               |
| Full type baseline at this exact integration-base vs checked docs | 1444 diagnostics each; full diagnostic text byte-identical |
| Dependency package records vs the frozen r6 inventory             | All 15,652 manifest hashes/inodes/link counts unchanged    |

The two explicit path lists have union exactly equal to the 84-file fixed diff. Test totals are separate command results, not a claim of 1658 unique tests: related tests can overlap. The previously failing RuntimeExecutors and subAgentRuns owning files are included and pass; the original three plus twelve fixture failures do not recur. No product source or test assertions were modified by these checks, and no package installation ran.

Evidence directory: `.acceptances/hooks-d-fixed507-quality-r8/assets/`. `provenance.json` and `complete-scope.json` contain the commands, exact path lists, ranges and revisions. `check.log` and `f-initial-supplement.log` are the full logs, with their separate exit results. `comparison.json` records the diagnostic and dependency comparison. The full-type baseline is reused from r7's `types-base.log` at this same integration SHA and unchanged dependency graph. D's actual environment remains Node 24.21.0/Bun 1.4.2. The 73-file command exits 1 because types are red; no full-type or CI success is claimed.

## Product and review boundary

The fixed SHA and conflict history were sent immediately to the coordinator. The coordinator owns the single final independent review; D has not triggered it or closed P1. The final acceptance-checker evidence review is also unused.

[Cold-card evidence](cold-card-checkpoint.md) confirms original-row cold B and a fresh-source Web B→C repark followed by actual device C execution. It also records the separate missing-source-state path that created a hooks-free continuation; that defect remains with C2. The old row does not have successful B execution or provider-prompt B evidence. Successful model/next-provider context and managed QStash are blocked on credentials; generic Cloud Review remains blocked by the private Cloud compatibility issue after applying the official ASR patch. Existing evidence is neither relabeled nor rerun just to publish this quality checkpoint. PR20137 stays draft, with no final acceptance URL or ready claim.
