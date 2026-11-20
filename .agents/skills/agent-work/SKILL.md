---
name: agent-work
description: 'Use for the Agent Work output registry: registration, deduplication, cards, skill providers, CLI scanners and Work types.'
user-invocable: false
---

# Agent Works

A **Work** is a durable record of something an agent produced or touched — a GitHub PR/issue, a Linear issue, an entity file (pptx/xlsx/docx/pdf), a document, a task. Works render as cards under the assistant message that produced them and accumulate **versions** across operations, so the same PR edited twice shows one card with history.

Two tables (`packages/database/src/schemas/work.ts`):

- `works` — one row per resource. Identity/dedup key: `(resourceType, resourceId)` within the user/workspace scope and the share scope (see below). `currentVersionId` soft-references the latest version.
- `work_versions` — one row per registration event. Dedup: unique `(workId, toolCallId)`, so a retried registration with the same real tool call id is a no-op. Versions carry provenance (source message, producing tool) and operation-level `cumulativeCost` / `cumulativeUsage`.

## Type registry

`packages/database/src/models/work/registry.ts` is the single registry of Work types (`canvas` / `document` / `external` / `file` / `collection` / `goal_report` / `task`): `WORK_TYPE_ADAPTERS` is `satisfies Record<WorkType, WorkTypeAdapter>`, so a type added to `@lobechat/types` without an adapter is a compile error.

**Read-path compatibility gate**: `OPT_IN_WORK_TYPES` (currently `{'canvas', 'file', 'collection'}`) hides newer types from clients that did not opt in (`includeFileWorks`). Released Electron clients lag by weeks and crash on unknown type descriptors (`descriptor.getIcon` on `undefined`), so a request without the opt-in receives exactly the pre-`file` set. Any NEW Work type must ship behind the same kind of opt-in.

The gate has two kinds of emission points, and both must honor the client's declaration:

- **Pulled reads** (`message.getMessages`, `work.*` lists, `shareChat.getMessages`): the client service passes `includeFileWorks: true` on the request.
- **Pushed payloads** (the `uiMessages` snapshots and `message_patch` revisions built by `AgentRuntimeService.queryUiMessages`): no request carries the opt-in, so the starting client declares the `file_works` stream feature and the run stores it as `state.host.acceptsFileWorks`; approval continuations and group members inherit it. A pushed path that skips this check drops the card until the user reloads the page.

## Access scope (Agent Share visitors)

A share visitor's run executes as the creator, so owner scope alone cannot separate its Works. Every Work read and write takes a `WorkAccessScope` (`packages/types/src/work.ts`): `ordinary` sees only rows without share provenance; `agentShare` sees only rows stamped in `works.metadata.agentShare` with exactly that share/topic/visitor.

- `workOwnership` applies the scope on every path, so a new query built on it inherits the fence. Do not query `works` without it.
- Any registration path reachable from a visitor run (skill results, completion scans, anchor stamping) must build its `WorkModel` with the run's scope via `resolveRunWorkAccessScope`. A visitor run without a topic yields `null`: skip registration (fail closed) rather than registering unscoped into the creator's lists.
- The resource unique indexes include the visitor topic id, so the creator and each visitor topic keep separate rows for the same external resource.
- Visitor read payloads always drop the creator's `userId` / `workspaceId` and the spend snapshot (`toVisitorMessage`, `sanitizeVisitorWorks`).

## Orphaned Works (backing resource deleted)

`works.resourceId` has no FK, and deleting a document, task, or file never cascades into its Work (LOBE-13917). Deleting the Work would also drop its version history and its project and goal references. Each read surface handles orphans itself:

- **Resource-page galleries hide orphans.** These are `listByWorkspace` surfaces: `/resource`, `/resource/works`, and the project dashboard. They filter orphans out with `resourceLiveFilter` (`packages/database/src/models/work/internal.ts`). A task or document must still exist and not be trashed. A file Work's current-version `fileId` must point to a `files` row that exists and is not trashed. Restoring the resource brings the card back. Any new gallery-style Work list must apply the same filter.
- **Conversation surfaces keep the card.** These are `listByConversation` and the cards under messages; the conversation did produce the Work. `resourceDeleted` drives a click-time prompt (`useResourceDeletedPrompt`) that lets the user remove it.

## Registration write paths

Five write paths, two timing classes:

| Path                                                                    | When                                | Where                                                                                                                                                               |
| ----------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skill structured tools + sandbox `runCommand` (github / linear)         | at tool execution                   | `WorkModel.handleSkillToolResult`, called from server `toolExecution` and the client executor (`registerClientWorkFromIntent.ts` on the legacy non-gateway runtime) |
| Shell Work scan (hetero codex/claude-code + device `lobe-local-system`) | at operation completion             | `apps/server/src/services/workRegistration/shellWorkRegistration.ts` via `registerWorksForOperation`                                                                |
| File Work scan (sandbox entity files)                                   | at operation completion             | `apps/server/src/services/workRegistration/registerWorksForOperation.ts`                                                                                            |
| Task / document works                                                   | at creation by their owning feature | `WorkModel.registerTask` / `registerDocument`                                                                                                                       |
| Agent-created files and links (`lh work create\|update\|delete`)        | at the CLI call, during the run     | `work.createAgentWork` / `updateAgentWork` / `deleteAgentWork` → the same-named `WorkModel` methods (`packages/database/src/models/work/agentWork.ts`)              |
| Agent-created collections and links (`lobe-work` tool)                  | at the tool call, during the run    | `apps/server/src/services/toolExecution/serverRuntimes/work.ts` → the same `WorkModel` methods                                                                      |

### Agent-created Works and `agentEditable`

`works.metadata.agentEditable` is stamped once, when the identity is first registered, and decides whether the agent may change the Work later. `lh work` and the `lobe-work` tool stamp it on everything they create; every other path leaves it unset unless the tool API's manifest `work` config declares `agentEditable: true` (`PluginApiWorkConfig`). Update and delete refuse a Work without the flag, a Work of another user, and a Work no version of which came from the run's conversation; delete also refuses a Work a goal node, delivery or project references (those links cascade from the Work, so deleting it would silently drop them). They handle only file, link and collection Works: a task or document card mirrors its own resource, so rewriting the card title would leave the two disagreeing. `lh work create` also refuses to add a version to an auto-collected Work with the same identity (for example a file path the completion scan already registered). Declare future agent-facing field policy (such as a system-owned price) on the same manifest config instead of special-casing write paths.

- The run is resolved server-side from `operationId` (`resolveAgentWorkRun`): topic, agent and share scope come from the operation row, and versions are stamped with the root of its `parentOperationId` chain so run completion fills their cost; and an operation token needs the `work:write` capability. A desktop-local run has no operation row and cannot use it.
- The CLI sends only the uploaded file id; size, type and URL come from the file row (`resolveAgentWorkFile`).
- Links register as external `resourceType: 'link'` with `<userId>:<topicId>:<canonical URL>` as identity (`linkWorkResourceId`), like file Works: the same link again in the same conversation adds a version, while another conversation or workspace member gets a Work of its own. `works.url` holds the URL; `lh work update` never changes it (the identity would then name the old URL), so a new URL is a new Work. GitHub and Linear links are refused because their own paths register them.
- A `collection` Work (`resourceType: 'collection'`, `col_` resource id) holds an ordered image list in `work_versions.metadata.collection`; every create is a new collection and every update stores the complete list. `works.url` holds the cover URL for list rows. Images must be image files of the run's user (`resolveAgentWorkCollectionItems`), named by the `generationId` image generation lists (resolved through `generations.fileId`), a file id or a `/f/<id>` link. Generated images and run outputs qualify as they are, and in a share visitor run their id must also appear in a tool result (`role = 'tool'`) of the visitor topic; a visitor's own message, an assistant echo or a `lobe-work` refusal does not count. Any other image (the cloud sandbox stores `exportFile` results without a source) qualifies only through the `fileId` in the state of a `lobe-cloud-sandbox` or `lobe-skills` `exportFile` call of the run's topic, never through message text. The item count is checked before any image is resolved.
- Delete removes the Work row and, through the FK cascade, its versions; the files stay.
- `rootOperationId` is the run's operation, so the completion lifecycle stamps the display anchor; the card appears after the run completes.

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
- **`owner/repo#number` is the canonical github identity**, not node_id: the gh CLI surface never returns node_id, and the same entity touched via REST tools and CLI must land on one Work row.
- **stdout is the source of truth for identity** on the CLI path (`gh … create/edit` prints the entity URL); the command's edit target is the fallback. The LAST gh create/edit segment of a chained command owns the trailing URL.
- **Persisted URLs are http(s)-allowlisted** (`sanitizeExternalUrl`): gh stdout / tool results are member-controlled and the URL reaches `shell.openExternal` on desktop.
- **Partial registrations merge version metadata too.** With `patchFields`, `registerWorkVersion` spreads the new `metadata` over the current version's, so a GitHub PR's `headBranch` / `baseBranch` (from `--head` / `--base` or REST `head.ref` / `base.ref`) survive an edit that names neither. A key cannot be cleared on that path; a provider that needs to unset one must send a complete registration.
- **GitHub state is drawn, not written.** The card's icon carries open / draft / merged / closed (`GITHUB_STATES` in `src/features/Work/descriptors.tsx`), so GitHub descriptions never fall back to the status word. The stored status only changes on create/edit registrations; a merge does not register, so a merged PR keeps its last registered state.
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
