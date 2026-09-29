# r26: Three tool-hook payload identity integration

This integrates the fixed successor explicitly identified by the coordinator's completion, not a floating branch or the independent F target refactor.

- C2: `f3a0b0219e9c80e40e836323f12bca9bb02214c5`; C2 base `7c1eb9e5b343d7aeda7d9df8f25087ebef6e11b3`.
- Included T `02346b507ef664710af0900f83fbf80053b43779` and C1 `0244d7d344890bdcc25babebc204cbb50849706f`.
- D previous base `d33ba0d76d8ae0c434d2acdf7ba07c8ef5684816`; new base `647ab2bb3cb73ff0542a082bb499fde2354d3228`; docs merge `70005f83b75d9ededca9f3bed94dcb52256de21b`.

Both merges were conflict-free. S767/K5e3/Lb9 and prior 936 diagnostics remain ancestors. Four upstream files changed (+156/-1); D adds no product implementation.

## Identity boundary

The tool-event builder now resolves payload `userId` from trusted `state.principal.actor.shareVisitor.visitorUserId`, then runtime owner, then origin owner. Preparation/control, before-tool observation, after-tool and tool-error payloads share this builder. Execution, permissions and database ownership remain owner-scoped. No `actorUserId` field is introduced.

This is the **three tool-hook** increment only. L's remaining 13 producers/callback work and the independent F mutually exclusive target refactor are not part of this fixed input. Do not describe this head as all 16 hooks implementing the new identity contract. Full actor-versus-owner local/queue/continuation/parent-child product evidence must follow the separately authorized identity integration.

## D quality evidence

Node24.21.0/Bun1.4.2 and the existing D dependencies were reused. No install or service restart occurred. Rechecking 305,353 existing `.pnpm` entries against the r25 inventory found no size/mtime/symlink changes; this is not a content-hash proof or new-file scan.

The explicit seven-path command in `.acceptances/hooks-d-tool-identity-r26/assets/current-check.log` covers builder, RuntimeExecutors, actual control preparation, worker hooks, approval resume and generic Stop. Result: **312 tests passed, lint clean; full type failed**. Product source was unchanged by lint.

Full current type has **1444 diagnostics**, byte-identical complete diagnostic text to the immediately preceding r25 `d33ba0d7` check on this unchanged dependency graph. That baseline log is reused, not claimed as a second new run. Current combined command exited1; C2's own type-clean environment is not transferred to D.

Ignored raw evidence: `.acceptances/hooks-d-tool-identity-r26/assets/{integration.json,base-merge.log,current-check.log,current-check.exit,type-comparison.json,dependencies.json}`.

## Product and publication limits

No identity product acceptance was run. Earlier r7/r17/r20/r21/r23 retain their original served SHA, explicitly seeded input and scope. Last served Cloud69c38102/OSSab5d35a6 is unchanged. The existing 31-item ledger remains historical behavior coverage, not proof of this new identity payload.

Lody identity-service failure still prevents remote publication; the last confirmed remote base/docs remain ab5d35a6/b15a936f. This local integration does not imply a successful push or updated PR body. PR remains draft, independent review allocation is exhausted, and final acceptance checker remains unused. The r24 SWR issue is assigned to independent owner session9b7dcbe2; no D/C2 frontend fix is included.
