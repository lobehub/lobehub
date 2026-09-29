# r25: Fixed delivery diagnostics integration

This is a quality/integration checkpoint, not another product acceptance run.

- Previous integration: `ab5d35a6d7b4f009866677f4304b29dea9ac0da1`.
- Fixed owner head: C2 `936b09cc712d8f709992306844681e5f47303e2b`, owner base `14fdab64c16d498f871ba9ef731626ac84104c9d`.
- D integration: `d33ba0d76d8ae0c434d2acdf7ba07c8ef5684816`; docs merge: `03584d48842f3687bf097d198b18c5359efeca7b`.
- Both merges had no conflicts or manual resolutions. Ancestry includes new C1 `9b3ba7a7`, F `74aa0c02`, S `76707138`, K `5e3a2f73`, L `b9fda258`, H `1c2d49f3`, T `2354874`, and previous integration `ab5d35a6`.

The upstream increment contains four files (+88/-9): safe QStash error classification/logging and associated HTTP/dispatcher assertions. No D product patch was added. The previous pending-UI diagnosis commit `6f063fac` is retained.

## D environment and checks

Actual D runtime: Node `v24.21.0`, Bun `1.4.2`. No install, dependency upgrade, shared-store write, or service restart was performed. Runtime/types/database workspace resolution points to this D worktree. This does not borrow C2's Node 26/type-clean conclusion.

`bun run check --type` was run on old integration `ab5d35a6`, followed by the explicit nine-path lint/test/type command on `d33ba0d7` (the full command is the first line of `current-check.log`). Paths cover HTTP, dispatcher, contract, control preparation, worker hooks, approval resume and generic Stop routing.

- Nine explicit paths: **240 tests passed; lint clean**. Check autofix left product files unchanged.
- Full type: **1444 before / 1444 current; failed**. Extracted complete diagnostic text is byte-identical, including continuation/detail lines. Both commands exited 1; the combined quality gate is not passed.
- All 305,353 inventoried entries were unchanged. The pre/post dependency inventory rechecks existing `.pnpm` file size, modification time and symlink targets. It is not a content-hash proof or a scan for newly added paths. See `dependency-comparison.json` for the measured result.

Raw local evidence: `.acceptances/hooks-d-qstash-diagnostics-r25/assets/` contains `base-type.log`, `current-check.log`, exit statuses, `type-comparison.json`, `upstream-production.diff`, `integration.json`, `environment.json`, and dependency manifests.

## Evidence and publication boundary

No new served SHA is claimed. Private Cloud remains `69c38102` with the last tested nested OSS `ab5d35a6`; r7/r12/r15/r16/r17/r20/r21/r23 retain their own original execution versions and limits. Managed QStash and successful model inference are still unverified. The [31-item ledger](current-results.md) and [pending UI diagnosis](pending-ui-diagnosis.md) remain applicable; no gap is promoted to passed.

The merge's first push attempt was blocked by the Lody GitHub identity service, which explicitly reported that no GitHub operation was attempted. Local commits and remote publication must be distinguished until push/readback succeeds. PR remains draft; neither an additional independent code review nor the final acceptance checker was invoked.
