# Builtin Tool Architecture

## The Five Faces

A builtin tool ships five distinct faces, each compiled into a different bundle:

```
┌─────────────────────────────────────────────────────────────────┐
│ ./                                                              │
│   Manifest + Types + systemRole                                 │
│   ─ Pure data, no React, no Node-only deps.                     │
│   ─ Imported by: server (LLM tool spec), client (registries),   │
│     anyone who needs to know "what tools exist".                │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ ./executionRuntime                                              │
│   src/ExecutionRuntime/index.ts                                 │
│   ─ Pure runtime logic. Accepts services via constructor —      │
│     never imports concrete services or stores directly.         │
│   ─ Imported by: server (BuiltinServerRuntimeOutput), tests,    │
│     and the client executor as a delegate.                      │
│   ─ Returns: BuiltinServerRuntimeOutput { content, state, … }   │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ ./executor                                                      │
│   src/client/executor/index.ts                                  │
│   ─ BaseExecutor subclass. Wires Zustand stores and frontend    │
│     services into ExecutionRuntime, then funnels through        │
│     toResult() into BuiltinToolResult { content, state, error,  │
│     success }.                                                  │
│   ─ Imported by: src/store/tool/slices/builtin/executors/       │
│     index.ts (registered as a singleton).                       │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ ./client                                                        │
│   src/client/{Inspector,Render,Placeholder,Streaming,           │
│              Intervention,Portal,components}/                   │
│   ─ React 'use client' surfaces. Read args + pluginState.       │
│   ─ Imported by: packages/builtin-tools/src/{inspectors,        │
│     renders,placeholders,streamings,interventions,portals}.ts.  │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ Registry wiring                                                 │
│   packages/builtin-tools/src/*.ts                               │
│   src/store/tool/slices/builtin/executors/index.ts              │
│   ─ Aggregator maps: identifier → { apiName → component }.      │
└─────────────────────────────────────────────────────────────────┘
```

The split exists so:

- Server bundles import only `./` and `./executionRuntime` and never touch React.
- Frontend bundles import `./client` and never touch Node-only services.
- The runtime is testable without React or Electron present.

---

## Why ExecutionRuntime is the Default Home for Logic

**Old pattern (grandfathered):** business logic in `src/executor/` directly. Examples: `builtin-tool-task`, older tools. Works, but the executor mixes runtime logic with frontend service plumbing — hard to reuse on the server.

**New pattern (preferred):** business logic in `src/ExecutionRuntime/`, frontend wiring in `src/client/executor/`. Examples: `builtin-tool-local-system`, `builtin-tool-web-browsing`, `builtin-tool-calculator`.

```
ExecutionRuntime
  ├─ accepts services via constructor (or `static create(opts)`)
  ├─ returns BuiltinServerRuntimeOutput (content + state + success)
  └─ no React, no Zustand, no `@/services/...` direct imports

client/executor
  ├─ extends BaseExecutor<typeof <Name>ApiName>
  ├─ holds a `runtime = new <Name>ExecutionRuntime(realService)` instance
  ├─ each ApiName method:
  │     1. resolve scope / pull defaults from BuiltinToolContext
  │     2. call runtime.<method>(args)
  │     3. funnel through toResult() → BuiltinToolResult
  └─ exported singleton: export const <name>Executor = new <Name>Executor()
```

### Service injection

`ExecutionRuntime` should declare a TypeScript interface for the services it needs and accept the implementation via constructor. Server callers wire in real implementations; tests wire in mocks. Example from `local-system`:

```ts
export interface ILocalSystemService {
  readLocalFile: (params: any) => Promise<any>;
  writeFile: (params: any) => Promise<any>;
  /* … */
}

export class LocalSystemExecutionRuntime extends ComputerRuntime {
  constructor(private service: ILocalSystemService) {
    super();
  }
  /* methods delegate to this.service.* */
}
```

The `client/executor` instantiates it once with the real service:

```ts
import { localFileService } from '@/services/electron/localFileService';
import { LocalSystemExecutionRuntime } from '../../ExecutionRuntime';

class LocalSystemExecutor extends BaseExecutor<typeof LocalSystemApiEnum> {
  private runtime = new LocalSystemExecutionRuntime(localFileService);
  /* … */
}
```

### When ExecutionRuntime is the only thing you ship

Some tools are server-only — there's no frontend executor. `builtin-tool-web-browsing` is the canonical example: only `./` and `./executionRuntime` are exported, no `./executor`, and the runtime is constructed by the server-side `ToolExecutionService`. Skip `client/executor/` entirely for those.

### When the executor reuses the runtime as-is

Pure-compute tools (`builtin-tool-calculator`) often have an executor whose ApiName methods call `executor.calculate(args)` and an `ExecutionRuntime` whose methods call `calculatorExecutor.calculate(args)` — same logic, two thin wrappers. That's fine; the duplication buys you the bundle split.

---

## The Result Contract

### `BuiltinServerRuntimeOutput` (what ExecutionRuntime returns)

```ts
{
  content: string;        // the LLM-facing text — never undefined; default to error message
  state?: any;            // result-domain object the UI reads as pluginState
  success: boolean;       // mandatory
  error?: any;            // raw error; the executor will repackage
}
```

### `BuiltinToolResult` (what the executor returns to the runtime)

```ts
{
  success: boolean;
  content?: string;
  state?: any;
  error?: { type: string; message: string; body?: any };
  metadata?: Record<string, any>;   // rare; e.g. { agentCouncil: true }
  stop?: boolean;                   // rare; halt the orchestration step
}
```

### The `toResult` funnel (mandatory)

Every executor method returns through a single `toResult()` to enforce two invariants:

1. **`content` is never undefined.** A missing content collapses downstream into `''`, leaving the Debug pane blank while `pluginState` was already saved. See the `globLocalFiles` regression in `local-system/src/client/executor/index.ts:60-84`.
2. **`state` survives failures.** Renderers can keep showing partial output even when `success: false`.

```ts
private toResult(output: BuiltinServerRuntimeOutput): BuiltinToolResult {
  const errorMessage = typeof output.error?.message === 'string' ? output.error.message : undefined;
  const safeContent  = output.content || errorMessage || 'Tool execution failed';

  if (!output.success) {
    return {
      success: false,
      content: safeContent,
      state:   output.state,
      error:   output.error
        ? { type: 'PluginServerError', message: errorMessage ?? safeContent, body: output.error }
        : undefined,
    };
  }
  return { success: true, content: safeContent, state: output.state };
}
```

---

## `BaseExecutor` — How Method Dispatch Works

`BaseExecutor.invoke(apiName, params, ctx)` does:

```ts
if (!this.hasApi(apiName)) return { error: { type: 'ApiNotFound', … }, success: false };
return (this as any)[apiName](params, ctx);   // method name MUST equal apiName value
```

So:

- **Method names must equal `<Name>ApiName` values, exactly.** A typo silently routes to "ApiNotFound".
- **Methods must be class fields, not class methods**, because `this` is lost when registry calls `executor.invoke(apiName, params, ctx)`. Always declare as `methodName = async (…) => { … }`.
- **Always destructure `apiEnum` and `identifier` as `readonly` instance fields**, not getters — `BaseExecutor.hasApi/getApiNames` reads them synchronously.

---

## `BuiltinToolContext` — What the Executor Receives

The runtime hands every executor method an optional `BuiltinToolContext` as the second argument:

| Field                         | Use                                                            |
| ----------------------------- | -------------------------------------------------------------- |
| `agentId`                     | Default agent for "current agent" semantics (e.g. `listTasks`) |
| `groupId`                     | Group chat scope                                               |
| `topicId`                     | Current topic — needed when creating messages/operations       |
| `taskId`                      | Current task identifier — fallback for "implicit" param        |
| `documentId`                  | Current page/document scope                                    |
| `messageId`                   | The tool message being created (for state attachments)         |
| `sourceMessageId`             | The user message that triggered this tool turn                 |
| `operationId`                 | Operation lineage (use for cancellation, tracing)              |
| `scope`                       | `'task' \| 'agent' \| …` — toggles default behaviors           |
| `signal: AbortSignal`         | Honor for long-running ops                                     |
| `stepContext`                 | Cross-message runtime state (GTD todos, etc.)                  |
| `registerAfterCompletion(cb)` | Defer side-effects past message-update race                    |
| `groupOrchestration`          | Group orchestration callbacks                                  |

**Use rule:** read with `?.`, fall back to explicit params, **never silently override** an explicit param with a context value.

---

## i18n Integration

Source of truth: `src/locales/default/plugin.ts`. Keys follow `builtins.<identifier>.<topic>.<…>`:

| Key                                   | Use                                                          |
| ------------------------------------- | ------------------------------------------------------------ |
| `builtins.<identifier>.title`         | Display title (overrides `manifest.meta.title` when present) |
| `builtins.<identifier>.apiName.<api>` | Inspector header label (one per ApiName)                     |
| `builtins.<identifier>.inspector.<…>` | Extra Inspector strings ("no results", chips, counters)      |
| `builtins.<identifier>.<feature>.<…>` | Render / Intervention strings, free-form per tool            |

For dev preview, also seed `locales/zh-CN/plugin.json` and `locales/en-US/plugin.json`. Run `pnpm i18n` before opening a PR — it's slow, so do it once at the end. (See the **i18n** skill for the full workflow.)

---

## Registry Wiring

Five core files plus optional ones. Miss any and you'll see "tool not found", a missing chip, a blank result card, a stuck spinner, or an approval dialog that never appears.

| File                                               | Add what                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Required**                                       |                                                                                           |
| `packages/builtin-tools/src/index.ts`              | Import `<Name>Manifest`; push entry to `builtinTools`. Set `hidden`/`discoverable` flags. |
| `packages/builtin-tools/src/identifiers.ts`        | Add `<Name>Manifest.identifier` to `builtinToolIdentifiers`.                              |
| `packages/builtin-tools/src/inspectors.ts`         | Import `<Name>Inspectors, <Name>Manifest`; add to `BuiltinToolInspectors`.                |
| `src/store/tool/slices/builtin/executors/index.ts` | Import `<name>Executor`; add to `registerExecutors([…])`.                                 |
| **Conditional — add only if the surface exists**   |                                                                                           |
| `packages/builtin-tools/src/renders.ts`            | Add to `BuiltinToolsRenders` if any API has a Render.                                     |
| `packages/builtin-tools/src/placeholders.ts`       | Add to `BuiltinToolPlaceholders` if any API has a Placeholder.                            |
| `packages/builtin-tools/src/streamings.ts`         | Add to `BuiltinToolStreamings` if any API has a Streaming renderer.                       |
| `packages/builtin-tools/src/interventions.ts`      | Add to `BuiltinToolInterventions` if any API has an Intervention component.               |
| `packages/builtin-tools/src/portals.ts`            | Add to `BuiltinToolsPortals` if the tool has a Portal.                                    |
| `packages/builtin-tools/src/displayControls.ts`    | Add if Render must show/hide based on result content (rare; see ClaudeCode/Codex).        |

### Optional flags in `packages/builtin-tools/src/index.ts`

```ts
{
  identifier: TaskManifest.identifier,
  manifest:   TaskManifest,
  type:       'builtin',
  hidden:        true,   // hide from chat-input Tools popover
  discoverable:  false,  // exclude from agent builder / skill discovery
}
```

Lists in the same file you may need to touch:

- `defaultToolIds` — added to the agent's tool list by default
- `alwaysOnToolIds` — forced on regardless of user selection (use sparingly)
- `runtimeManagedToolIds` — enable state controlled by runtime, not user UI; **must mirror the rules map** in `src/server/modules/Mecha/AgentToolsEngine/index.ts` and `src/helpers/toolEngineering/index.ts`

---

## File-Map at a Glance

```
packages/builtin-tool-<name>/
├── package.json                          # exports: ., ./client, ./executor, ./executionRuntime
└── src/
    ├── index.ts                          # export Manifest, Identifier, types, systemPrompt
    ├── manifest.ts                       # BuiltinToolManifest + Identifier const
    ├── types.ts                          # ApiName + Params/State per API
    ├── systemRole.ts                     # System prompt (multiple variants OK: systemRole.desktop.ts)
    ├── ExecutionRuntime/
    │   └── index.ts                      # <Name>ExecutionRuntime — pure runtime, service injection
    └── client/
        ├── index.ts                      # exports for the registries
        ├── executor/
        │   └── index.ts                  # <Name>Executor extends BaseExecutor; export <name>Executor
        ├── Inspector/
        │   ├── index.ts                  # <Name>Inspectors record
        │   └── <ApiName>/index.tsx       # one folder per API (or .tsx file when trivial)
        ├── Render/
        │   ├── index.ts                  # <Name>Renders record
        │   └── <ApiName>/                # rich renders → folder with subcomponents
        ├── Placeholder/
        │   ├── index.ts
        │   └── <ApiName>.tsx             # usually a single skeleton file
        ├── Streaming/
        │   ├── index.ts
        │   └── <ApiName>/                # live-output renderer
        ├── Intervention/
        │   ├── index.ts
        │   └── <ApiName>/                # approval / edit-before-run UI
        ├── Portal/
        │   ├── index.tsx                 # routing component (switch on apiName)
        │   └── <ApiName>/                # full-screen detail view
        └── components/                   # FileItem, EngineAvatar, etc. — shared subcomponents
```

Skip every `client/<surface>/` directory you don't need — empty registries are fine.
