---
name: agent-work
description: 'Agent Work registry (works / work_versions): how agent outputs — github/linear entities, files, documents, tasks — get registered, deduped, and rendered as cards, and how to extend it with a new skill provider, a new shell CLI scanner, or a new Work type.'
user-invocable: false
---

# Agent Works

A **Work** is a durable record of something an agent produced or touched — a GitHub PR/issue, a Linear issue, an entity file (pptx/xlsx/docx/pdf), a document, a task. Works render as cards under the assistant message that produced them and accumulate **versions** across operations, so the same PR edited twice shows one card with history.

Two tables (`packages/database/src/schemas/work.ts`):

- `works` — one row per resource. Identity/dedup key: `(resourceType, resourceId)` within the user/workspace scope. `currentVersionId` soft-references the latest version.
- `work_versions` — one row per registration event. Dedup: unique `(workId, toolCallId)`, so a retried registration with the same real tool call id is a no-op. Versions carry provenance (source message, producing tool) and operation-level `cumulativeCost` / `cumulativeUsage`.

## Type registry

`packages/database/src/models/work/registry.ts` is the single registry of Work types (`document` / `external` / `file` / `task`): `WORK_TYPE_ADAPTERS` is `satisfies Record<WorkType, WorkTypeAdapter>`, so a type added to `@lobechat/types` without an adapter is a compile error.

**Read-path compatibility gate**: `OPT_IN_WORK_TYPES` (currently `{'file'}`) hides newer types from clients that did not opt in (`includeFileWorks`). Released Electron clients lag by weeks and crash on unknown type descriptors (`descriptor.getIcon` on `undefined`), so a request without the opt-in receives exactly the pre-`file` set. Any NEW Work type must ship behind the same kind of opt-in.

## Registration write paths

Four write paths, two timing classes:

| Path                                                                    | When                                | Where                                                                                                                                                               |
| ----------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skill structured tools + sandbox `runCommand` (github / linear)         | at tool execution                   | `WorkModel.handleSkillToolResult`, called from server `toolExecution` and the client executor (`registerClientWorkFromIntent.ts` on the legacy non-gateway runtime) |
| Shell Work scan (hetero codex/claude-code + device `lobe-local-system`) | at operation completion             | `apps/server/src/services/workRegistration/shellWorkRegistration.ts` via `registerWorksForOperation`                                                                |
| File Work scan (sandbox entity files)                                   | at operation completion             | `apps/server/src/services/workRegistration/registerWorksForOperation.ts`                                                                                            |
| Task / document works                                                   | at creation by their owning feature | `WorkModel.registerTask` / `registerDocument`                                                                                                                       |

### Execution-time: skill providers

`SKILL_TOOL_RESULT_NORMALIZERS` in `packages/database/src/models/work/index.ts` maps `WorkSkillProvider` (`github`, `linear`; vocabulary in `packages/types/src/work.ts`) to a normalizer. Both `satisfies` a `Record<WorkSkillProvider, …>`, so provider list and normalizer map cannot drift.

A normalizer turns one tool result into `ExternalToolWorkOperation | null` — null means "not Work-worthy", which is the common case and never an error.

### Completion-time: the shell Work scan framework

Heterogeneous CLI agents (codex, claude-code) and the device `lobe-local-system` tool run CLIs like `gh` through their own shell surfaces, which never pass the skill-tool hook. `registerWorksForOperation` recovers their Works at completion from the persisted command text + stdout. Layering:

```
registerWorksForOperation (registerWorksForOperation.ts)
  ├─ collectOperationRecords         one pass over the operation tree, shared by both scans
  ├─ registerShellWorks              (shellWorkRegistration.ts — the ENGINE, command-agnostic)
  │    ├─ SHELL_COMMAND_SOURCES      identifier→apiName scoping of shell surfaces
  │    ├─ success gate               plugin error / state.success===false / state.error → skip
  │    ├─ extract {command, exitCode, output}   from arguments / state / message content
  │    └─ shellWorkScanners/         one file per CLI family
  │         ├─ types.ts              ShellWorkScanner = { matches, name, register }
  │         ├─ github.ts             matches: includes('gh ') → workModel.registerShellGithubResult
  │         └─ index.ts              SHELL_WORK_SCANNERS registry
  └─ file Work scan                  aggregate per-path fold + sandbox export pipeline (NOT a scanner)
```

Command parsing is split the same way: `packages/database/src/models/work/shellCommandParsing.ts` holds the command-agnostic layer (POSIX-ish tokenizer, control-operator segmenting, codex `/bin/zsh -lc` wrapper expansion — `parseShellCommandSegments`), while `githubToolResult.ts` holds only the gh-specific `parseGhSegment` + field mapping.

### Cost granularity: execution-time vs completion-time

`cumulativeCost` / `cumulativeUsage` are per-version SNAPSHOTS ("spend up to this version"), never deltas — summing them across versions double-counts on every path.

- **Execution-time registrations** (skill providers) snapshot right after `UsageCounter.accumulateTool` for that call, so create + edit + edit within one run carries an INCREASING series (e.g. $0.30 → $0.70 → $1.20) and step deltas are recoverable.
- **Completion-time registrations** (shell scan, file scan) attach one OPERATION-LEVEL figure — the completing run's terminal total plus terminal child-op totals — to EVERY version registered that round: the scan only has persisted command text + stdout, no per-call intermediate snapshots (hetero CLI usage is aggregated per step by the trace recorder, not per tool call). The same create + edit + edit therefore yields three versions all carrying $1.20, indistinguishable per step.
- Cross-operation is independent: a later run editing the same resource appends a version with THAT run's total only.

**Why file Works are not a scanner**: their unit is a file path folded across ALL records (multi-edit merge, renames, last-edit provenance), the registration is a heavy IO pipeline (idempotency probe → sandbox export → upload → version → redeploy, bounded concurrency), hetero records are deliberately EXCLUDED (the file lives on the executing device, not the exportable sandbox), and the version key is the synthetic `op:${operationId}` instead of a real toolCallId. Shoehorning that into `ShellWorkScanner` would break the interface. If a second aggregate-style scan ever appears, extract an aggregate layer then.

## Display anchor & completion marker

A Works card renders only under an assistant message stamped with `metadata.work.rootOperationId` (the "anchor"). Who stamps it:

- **In-process runs**: `callLlmFinalizer` stamps the round's final assistant message.
- **Hetero runs** never pass that executor, so `registerWorksForOperation` stamps the anchor itself when the shell scan registered anything — using the completion's `assistantMessageId`, falling back to the `parentId` of the last registered tool message (hetero single-step runs persist no final-assistant pointer at all; see `heteroFinish`).

The whole scan returns `{attempted, failed}` and the completion backstop (`CompletionLifecycle`) writes its idempotency marker only when `failed === 0`. Anything that must be retried — a thrown registration, a `{success: false}` anchor stamp, an unresolvable anchor — counts into `failed`. Registration is retry-safe end to end (probe short-circuits, `(workId, toolCallId)` guard backs it up), so counting a failure is always the right move.

## Key decisions (from the Work PRs)

- **Only successful create/edit results become Works** (LOBE-10967). Read-only queries, comments, merges/closes, and branch/repo operations are excluded — `gh pr view` printing an entity URL must NOT register.
- **`owner/repo#number` is the canonical github identity**, not node\_id: the gh CLI surface never returns node\_id, and the same entity touched via REST tools and CLI must land on one Work row.
- **stdout is the source of truth for identity** on the CLI path (`gh … create/edit` prints the entity URL); the command's edit target is the fallback. The LAST gh create/edit segment of a chained command owns the trailing URL.
- **Persisted URLs are http(s)-allowlisted** (`sanitizeExternalUrl`): gh stdout / tool results are member-controlled and the URL reaches `shell.openExternal` on desktop.
- **The tokenizer is deliberately hand-rolled** (no `shell-quote` dep): a real parser would expand what must stay literal, and the worst failure mode is skipping a bookkeeping registration.
- **Error-terminated runs skip the completion scan** (same success gate as file Works): a `gh` create that succeeds before a later terminal failure registers no Work that round. Accepted — bounded cost, missing card only.
- **Hetero Works register after the terminal snapshot** (`agent_runtime_end` publishes before `completeOperation`), so a hetero-created card appears on the next refetch, not in the terminal snapshot. Accepted for now.
- **PRs pushed via codex's own GitHub integration are not covered** — no shell record exists; text-mention parsing was rejected as too false-positive-prone.

## Extension recipes

**New skill provider (structured tools), e.g. Notion:**

1. `packages/types/src/work.ts` — extend `WORK_SKILL_PROVIDERS` + `WORK_PROVIDER_RESOURCE_TYPES` (+ resource-type unions).
2. `packages/database/src/models/work/<provider>ToolResult.ts` — write the normalizer; mirror `linearToolResult.ts`.
3. `packages/database/src/models/work/index.ts` — add it to `SKILL_TOOL_RESULT_NORMALIZERS` (the `satisfies` forces this).
4. Pick a stable cross-surface `resourceId` (the github lesson: choose the identity every surface can produce).

**New shell CLI scanner, e.g. `linear` CLI or `vercel deploy`:**

1. Add a normalizer in `packages/database/src/models/work/` reusing `parseShellCommandSegments`, plus a `WorkModel.registerShell<X>Result` facade method.
2. Add `apps/server/src/services/workRegistration/shellWorkScanners/<name>.ts` with `{ matches, name, register }` — `matches` stays a cheap substring check.
3. Append it to `SHELL_WORK_SCANNERS` in `shellWorkScanners/index.ts`. The engine needs zero changes.
4. Pin the parsing edge cases in `packages/database/src/models/work/__tests__/` (wrapper unwrap, chained segments, failed/read-only commands must not register).

**New Work type (new card kind):**

1. `@lobechat/types` — extend `WorkType` and related unions.
2. `packages/database/src/models/work/` — new adapter module + `WORK_TYPE_ADAPTERS` entry (compile-enforced).
3. Client — add the type descriptor for the card UI.
4. **Add the type to the read-path opt-in gate** (`OPT_IN_WORK_TYPES` pattern) — released clients throw on unknown types; never ship a new type into the legacy result set.

## File map

| Concern                                              | Path                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| Schema                                               | `packages/database/src/schemas/work.ts`                                  |
| Type registry + read gate                            | `packages/database/src/models/work/registry.ts`                          |
| WorkModel facade + provider normalizer map           | `packages/database/src/models/work/index.ts`                             |
| gh CLI + structured github normalizer                | `packages/database/src/models/work/githubToolResult.ts`                  |
| Command-agnostic shell parsing                       | `packages/database/src/models/work/shellCommandParsing.ts`               |
| Completion scan orchestrator (file + shell + anchor) | `apps/server/src/services/workRegistration/registerWorksForOperation.ts` |
| Shell scan engine                                    | `apps/server/src/services/workRegistration/shellWorkRegistration.ts`     |
| Desktop-local run scan (client-reported)             | `apps/server/src/services/workRegistration/localRunWorkRegistration.ts`  |
| Per-CLI scanners                                     | `apps/server/src/services/workRegistration/shellWorkScanners/`           |
| Client (non-gateway) registration                    | `src/store/chat/agents/registerClientWorkFromIntent.ts`                  |
