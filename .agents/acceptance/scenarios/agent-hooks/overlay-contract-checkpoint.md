# Overlay contract supplement — quality checks only

Latest Stop repair is submitted and temporarily integrated; see [stop-retry-checkpoint.md](stop-retry-checkpoint.md). Earlier candidate/uncommitted status below is historical. Cloud product evidence and final independent repair review remain open.

C2 `cde2ebce24983de0ff10d623992b131d7b22383a` is merged into D-owned integration-base `50001f8b7e50743c1daa2df35a7b6fa2e90131df`, without conflicts. S/K/L ancestry is verified. The delta from C2 83496341 contains exactly three files: TOOL\_CONTROL documentation and two existing test files, adding DTO reapprovedToolCallIds forwarding and same/cross-operation old-token/revision rejection assertions. Runtime code is unchanged; no merge repair was hidden in this update.

D executed:

```bash
ASDF_NODEJS_VERSION=24.21.0 bun run check --lint --test --type \
  apps/server/src/services/agentRuntime/__tests__/agentInterventionNotification.test.ts \
  packages/database/src/models/__tests__/agentIntervention.test.ts
```

Result: **64 tests passed / lint clean; full type failed**. Before switching to docs, D ran full type on the new integration-base using the same isolated dependencies. Base/current both have 1444 diagnostics with byte-identical diagnostic text. This is D's own comparison, not C2's clean result. Logs and provenance: `.acceptances/hooks-d-overlay-contract-r3/assets/{types-base.log,check.log,type-comparison.json,integration.json}`. This directory records quality only and is not a new product acceptance round.

The Cloud path was re-read in D's isolated clone at 4b2a3272: wrapperV2 forwards whole params, deliveryV2 forwards notification.supersedes, and defaultDeliveryV2 forwards the same object to the OSS model. The matching Cloud version needs the C2 OSS model and types; it does not need a new field-specific forwarding patch. The actual D Cloud app still fails compilation because its business-const overlay lacks DEFAULT\_ASR\_MODEL. These new DTO/model assertions do not prove deployed Cloud UI, partial/mixed approval membership, or review-token behavior through the real product.

No app or device was restarted for this test/documentation-only delta. Earlier HTTP/device/Web evidence remains bound to its original source revision; the runtime notification supplement remains on a471e387. When behavior changes in the pending owner fixes, record the actual served process executable/version, dependency graph and source SHA, then rerun affected paths and the final D base/current checks. Current shell Node 24.21.0 / Bun 1.4.2 is not a substituted served-Web probe.

The Stop critical retry P1, now reproduced by C2 according to the coordinator, and C1's nine CI fixture failures remain pending owner closure. Real model/managed-QStash access, rewritten approval-card mismatch, Cloud compatibility, coordinator repair review and final evidence review also remain open. PR20137 stays draft. No new acceptance pass, public documentation release or report URL is claimed.
