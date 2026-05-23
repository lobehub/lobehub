# Tool Design (Naming, Manifest, Executor, Runtime)

This doc covers everything that **isn't UI**: the tool's identifier, API surface, manifest, types, system prompt, ExecutionRuntime, and the executor that wires it into the frontend.

For UI surfaces (Inspector / Render / Placeholder / Streaming / Intervention / Portal), see [ui.md](ui.md).
For where files live and how registries work, see [architecture.md](architecture.md).

---

## 1. Naming

| Thing                   | Convention                                                     | Example                                                      |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| Package directory       | `packages/builtin-tool-<kebab>/`                               | `builtin-tool-task`                                          |
| npm name                | `@lobechat/builtin-tool-<kebab>`                               | `@lobechat/builtin-tool-task`                                |
| Tool `identifier`       | `lobe-<kebab-domain>` — **persisted in message history**       | `lobe-task`, `lobe-calculator`, `lobe-knowledge-base`        |
| Identifier const        | `<Name>Identifier` exported from `manifest.ts` (or `types.ts`) | `export const TaskIdentifier = 'lobe-task'`                  |
| API name const          | `<Name>ApiName` — `as const` object, **camelCase verbs**       | `createTask`, `listTasks`, `runTask`                         |
| Executor class          | `<Name>Executor extends BaseExecutor<typeof <Name>ApiName>`    | `TaskExecutor`                                               |
| Executor singleton      | `<name>Executor` (camelCase)                                   | `export const taskExecutor = new TaskExecutor()`             |
| ExecutionRuntime class  | `<Name>ExecutionRuntime`                                       | `LocalSystemExecutionRuntime`, `WebBrowsingExecutionRuntime` |
| Inspector / Render etc. | `<ApiName>Inspector` / `<ApiName>Render`                       | `CreateTaskInspector`, `SearchInspector`                     |

### Identifier rules

- **`lobe-` prefix is mandatory** — many switches in the codebase key off it.
- Pick a **domain noun**, not a verb (`lobe-task`, not `lobe-task-manager`).
- The identifier is **persisted in message history** — renaming after release means the `@deprecated` alias trick (register the legacy identifier as a second key in `inspectors.ts` / `renders.ts` pointing at the new module). Get it right the first time.

### ApiName rules

- Verb + noun, camelCase: `createTask`, `viewTask`, `runTasks`.
- **Plural variant for batch** (`createTasks`, `runTasks`) — describe in the manifest description that it's preferred over multiple single calls. The system prompt should also push the batch form.
- Reserve **clear separation between mutating verbs** (`updateTaskStatus`, `editTask`) and **execution verbs** (`runTask`). The system prompt must warn the model when these are confusable — see `task` for the canonical "do NOT use updateTaskStatus(running) to start a task" warning.
- Read-only verbs: `list*`, `view*`, `get*`, `search*`. Mutating: `create*`, `edit*`, `update*`, `delete*`. Triggers/effects: `run*`, `execute*`, `submit*`.

---

## 2. `types.ts` — ApiName + Params/State

Define `<Name>ApiName` as `as const` so it doubles as a runtime enum (used by `BaseExecutor`) and a literal type. Then declare `Params` and `State` per API.

```ts
export const TaskIdentifier = 'lobe-task';

export const TaskApiName = {
  createTask: 'createTask',
  createTasks: 'createTasks',
  listTasks: 'listTasks',
  /* …one entry per API, group logically (CRUD then run-style) */
} as const;

export type TaskApiNameType = (typeof TaskApiName)[keyof typeof TaskApiName];

// One block per API
export interface CreateTaskParams {
  name: string;
  instruction: string; /* … */
}
export interface CreateTaskState {
  identifier?: string;
  success: boolean;
}

export interface CreateTasksParams {
  tasks: CreateTaskParams[];
}
export interface CreateTasksItemResult {
  error?: string;
  identifier?: string;
  name: string;
  success: boolean;
}
export interface CreateTasksState {
  failed: number;
  results: CreateTasksItemResult[];
  succeeded: number;
}
```

**The result-domain rule for `State`** (memory: "pluginState is result-domain, not call-domain"):

- Include only fields the UI **renders after the call returns** — ids the LLM didn't have when calling, counts, summary numbers, server-assigned status.
- **Don't echo all params.** The Inspector/Render gets `args` for free.
- Keep batch results as `{ succeeded, failed, results }` so the Render can show a one-line summary plus a detail list.

---

## 3. `manifest.ts` — JSON Schema for the LLM

```ts
import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { TaskApiName, TaskIdentifier } from './types';

export const TaskManifest: BuiltinToolManifest = {
  identifier: TaskIdentifier,
  type: 'builtin',
  systemRole: systemPrompt,
  meta: {
    avatar: '📋',
    title: 'Task Tools',
    description: 'Create, list, edit, delete tasks with dependencies',
    readme: 'Optional long description shown in tool detail pages',
  },
  api: [
    {
      name: TaskApiName.createTask,
      description:
        'Create a new task. Optionally attach as a subtask via parentIdentifier. ' +
        'Prefer createTasks when planning a batch.',
      parameters: {
        type: 'object',
        required: ['name', 'instruction'],
        properties: {
          name: { type: 'string', description: 'Short, descriptive name.' },
          instruction: {
            type: 'string',
            description: 'Detailed instruction for what the task should accomplish.',
          },
          parentIdentifier: {
            type: 'string',
            description:
              'Identifier of the parent task (e.g. "TASK-1"). If provided, the new task becomes a subtask.',
          },
          priority: {
            type: 'number',
            description: 'Priority level: 0=none, 1=urgent, 2=high, 3=normal, 4=low. Default is 0.',
          },
        },
      },
    },
    /* …one entry per ApiName */
  ],
};
```

### Manifest writing checklist

- **Every API in `<Name>ApiName` has exactly one entry in `api[]`.** Easy to drift after a refactor.
- **`description` on each API is the model's only docs.** Make it long enough for the LLM to pick the right tool. Mention edge cases ("If you provide any filter, omitted filters are not applied implicitly"), defaults, and the relationship to sibling APIs ("To START a task, use runTask — updateTaskStatus only flips a flag").
- **`parameters` is JSON Schema** (`LobeChatPluginApi`). Use `enum`, `required`, `items`, `oneOf`, `additionalProperties: false` etc. — these survive into the LLM's tool spec.
- **Use `additionalProperties: false`** on parameter objects so the model can't sneak unknown fields past validation.
- **Number parameters with semantic values** (`priority: 0=none, 1=urgent, …`) should describe the mapping in the description. Don't rely on `enum` alone for numbers — the model often fills the wrong one.
- **`enum` arrays for known string sets** (statuses, categories, engines). Spread from a constants module (`enum: [...TASK_STATUSES]`) so the manifest stays in sync.

### Optional manifest fields

```ts
{
  /* Where this tool can run.
     'client'  → Agent Gateway dispatches to the desktop client (filesystem, Electron only)
     'server'  → ToolExecutionService runs it on the server
     omitted   → server only */
  executors: ['client', 'server'],

  /* Default human intervention policy for all APIs that don't specify one.
     Pair with an Intervention component (see ui.md). */
  humanIntervention: 'never' | 'always' | { /* extended config */ },
}
```

Per-API `humanIntervention` and `renderDisplayControl` go inside each `api[]` entry.

---

## 4. `systemRole.ts` — Operator Instructions for the Model

This is appended to the agent system prompt whenever the tool is enabled. Treat it as a **how-to-use guide for the LLM**, not marketing copy.

```ts
export const systemPrompt = `You have access to Task management tools. Use them to:

- **createTask**: Create a new task. Use parentIdentifier to make it a subtask.
- **createTasks**: Prefer this over multiple createTask calls when planning a batch
  (e.g. all subtasks under one parent, or all chapters of an outline).
- **runTask**: Actually START a task — kicks off the agent in a new (or continued)
  topic. Do NOT use updateTaskStatus(running) to start a task; that only flips a
  flag without executing. The task must have an assigneeAgentId.
- **updateTaskStatus**: Change a task's status (completed/cancelled/paused/failed).
  If you mark a task as failed, include an error message explaining why.
- ...

When planning work:
1. Create tasks for each major piece (use parentIdentifier to organize as subtasks).
2. Use editTask with addDependencies to control execution order.
3. Use updateTaskStatus to mark the current task completed when done.`;
```

### Patterns that work well

- **Bulleted list, bold the API name, one line per API.** The model picks tools by skimming.
- **Disambiguate confusable APIs explicitly** (`runTask` vs `updateTaskStatus`).
- **Push toward batched APIs** ("Prefer this when…").
- **End with a numbered workflow** if the tool has a typical sequence.
- **For tools with multiple environments** (e.g. desktop vs cloud), keep variants in `systemRole.ts` and `systemRole.desktop.ts` and pick at the manifest level. See `builtin-tool-local-system`.

### Dynamic system prompts

If the prompt depends on runtime state (current date, available models), export a function and call it in the manifest:

```ts
// systemRole.ts
export const systemPrompt = (today: string) => `Today is ${today}. You have web search tools…`;

// manifest.ts
import dayjs from 'dayjs';
systemRole: systemPrompt(dayjs(new Date()).format('YYYY-MM-DD')),
```

---

## 5. `ExecutionRuntime/index.ts` — Pure Runtime

This is **the default home for new tool logic** going forward. The runtime is a class that:

- Has no React, no Zustand, no `@/services/...` direct imports.
- Receives services as **constructor injection** (or as method args).
- Returns `BuiltinServerRuntimeOutput` from each method.
- Is unit-testable by passing in mocks.

### Pattern A: Inject a service interface

Use when the runtime calls out to IPC, network, or DB.

```ts
// ExecutionRuntime/index.ts
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

export interface IWebBrowsingService {
  search: (q: SearchQuery) => Promise<UniformSearchResponse>;
  crawlPages: (urls: string[]) => Promise<CrawlResults>;
}

export interface WebBrowsingRuntimeOptions {
  searchService: IWebBrowsingService;
  documentService?: WebBrowsingDocumentService;
  agentId?: string;
  topicId?: string;
}

export class WebBrowsingExecutionRuntime {
  constructor(private opts: WebBrowsingRuntimeOptions) {}

  async search(
    args: SearchQuery,
    options?: { signal?: AbortSignal },
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const data = await this.opts.searchService.search(args, options);
      if (data.errorDetail) {
        return {
          success: false,
          content: data.errorDetail,
          error: { message: data.errorDetail },
          state: data,
        };
      }
      return {
        success: true,
        content: searchResultsPrompt(data.results.slice(0, 10)),
        state: data,
      };
    } catch (e) {
      return { success: false, content: (e as Error).message, error: e };
    }
  }
}
```

### Pattern B: Reuse the executor

Use when the same logic runs in browser and Node (e.g. mathjs, nerdamer). The runtime is a thin wrapper that imports the executor and re-types the state per API. See `builtin-tool-calculator/src/ExecutionRuntime/index.ts` for the canonical example.

### Pattern C: Extend a shared base

When you're implementing a domain that already has a base runtime (file ops via `ComputerRuntime`), extend and only override `callService` + result normalization. See `builtin-tool-local-system/src/ExecutionRuntime/index.ts`.

### Runtime contract

Every method returns:

```ts
{
  content: string;       // LLM-facing — never undefined; default to error message
  state?: any;           // result-domain — what the UI's pluginState becomes
  success: boolean;      // mandatory
  error?: any;           // raw error object; the executor will repackage
}
```

Use `@lobechat/prompts` formatters (`searchResultsPrompt`, `crawlResultsPrompt`, `formatTaskCreated`, etc.) to produce structured `content`. They emit XML/markdown that's already tuned for token efficiency.

---

## 6. `client/executor/index.ts` — Frontend Wiring

The executor's job is to **resolve frontend defaults** (current agent, current task, scope) and **call the runtime**. It then funnels through `toResult()` into the `BuiltinToolResult` shape.

```ts
import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';
import debug from 'debug';

import { taskService } from '@/services/task';
import { getTaskStoreState } from '@/store/task';

import { TaskIdentifier } from '../../manifest';
import { TaskApiName, type CreateTaskParams } from '../../types';

const log = debug('lobe-task:executor');

class TaskExecutor extends BaseExecutor<typeof TaskApiName> {
  readonly identifier = TaskIdentifier;
  protected readonly apiEnum = TaskApiName;

  // ⚠ class FIELD, not a method — preserves `this` when invoked via registry
  createTask = async (
    params: CreateTaskParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('createTask params=%o', params);
      const task = await getTaskStoreState().createTask({
        name: params.name,
        instruction: params.instruction,
        // Default assignee from context — never silently override an explicit value
        assigneeAgentId:
          params.assigneeAgentId ?? (ctx?.scope === 'task' ? undefined : ctx?.agentId),
        parentTaskId: params.parentIdentifier?.trim() || undefined,
        priority: params.priority,
      });

      if (!task) return this.errorResult('Failed to create task', 'CreateFailed');

      return {
        success: true,
        content: formatTaskCreated({ identifier: task.identifier, name: task.name /* … */ }),
        state: { identifier: task.identifier, success: true },
      };
    } catch (error) {
      return this.errorResult(error, 'CreateTaskFailed');
    }
  };

  private errorResult(err: unknown, type: string): BuiltinToolResult {
    const message = err instanceof Error ? err.message : String(err) || 'Unknown error';
    return { success: false, content: `Failed: ${message}`, error: { type, message } };
  }
}

export const taskExecutor = new TaskExecutor();
```

### Hard rules

1. **Methods are class fields** (`name = async (…) => {…}`), not class methods. The registry calls `(executor as any)[apiName](params, ctx)`; arrow-function fields keep `this` bound.
2. **`identifier` and `apiEnum` are `readonly` instance fields**, not getters — `BaseExecutor.hasApi/getApiNames` reads them synchronously at registration time.
3. **Default missing params from `ctx`**, but never silently override explicit values. Use `params.foo ?? ctx?.foo`, not `ctx?.foo ?? params.foo`.
4. **One funnel for all returns.** Either always return through `toResult(runtime.x())` (when delegating) or through `errorResult(…)` for the catch arm. Never inline `{ success: false, content: '' }` — `content: ''` collapses the Debug pane to blank.
5. **`debug('lobe-<name>:executor')`.** Match the namespace to the identifier minus `lobe-` when convenient.
6. **Singleton export.** `export const <name>Executor = new <Name>Executor()` — the registry imports the instance, not the class.

### When the executor delegates to ExecutionRuntime

```ts
class LocalSystemExecutor extends BaseExecutor<typeof LocalSystemApiEnum> {
  readonly identifier = LocalSystemIdentifier;
  protected readonly apiEnum = LocalSystemApiEnum;
  private runtime = new LocalSystemExecutionRuntime(localFileService);

  readLocalFile = async (params: LocalReadFileParams): Promise<BuiltinToolResult> => {
    try {
      const result = await this.runtime.readFile({
        path: params.path,
        startLine: params.loc?.[0],
        endLine: params.loc?.[1],
      });
      return this.toResult(result);
    } catch (error) {
      return this.errorResult(error);
    }
  };

  private toResult(out: BuiltinServerRuntimeOutput): BuiltinToolResult {
    const errMsg = typeof out.error?.message === 'string' ? out.error.message : undefined;
    const safe = out.content || errMsg || 'Tool execution failed';
    if (!out.success) {
      return {
        success: false,
        content: safe,
        state: out.state, // ← preserve partial state on failure
        error: out.error
          ? { type: 'PluginServerError', message: errMsg ?? safe, body: out.error }
          : undefined,
      };
    }
    return { success: true, content: safe, state: out.state };
  }
}
```

The `toResult` funnel is **mandatory**: it enforces never-undefined `content` and partial-state preservation. Both invariants caught real production bugs (`globLocalFiles` Response empty, `editLocalFile` partial state lost).

---

## 7. `index.ts` — Package Entry Point

Keep it pure data + the manifest. **No React, no stores, no Node-only imports.**

```ts
export { TaskIdentifier, TaskManifest } from './manifest';
export { systemPrompt } from './systemRole';
export {
  TaskApiName,
  type TaskApiNameType,
  type CreateTaskParams,
  type CreateTaskState,
  /* …all Params/State types */
} from './types';

// Optional helpers used by both the runtime and the UI
export { TASK_STATUSES, UNFINISHED_TASK_STATUSES } from './constants';
```

This entry is what `packages/builtin-tools/src/index.ts` and `identifiers.ts` import — it must be importable from server bundles.

---

## 8. `package.json`

```json
{
  "dependencies": {
    "@lobechat/prompts": "workspace:*"
  },
  "devDependencies": {
    "@lobechat/types": "workspace:*"
  },
  "exports": {
    ".": "./src/index.ts",
    "./client": "./src/client/index.ts",
    "./executor": "./src/client/executor/index.ts",
    "./executionRuntime": "./src/ExecutionRuntime/index.ts"
  },
  "main": "./src/index.ts",
  "name": "@lobechat/builtin-tool-<name>",
  "peerDependencies": {
    "@lobehub/ui": "^5",
    "antd": "^6",
    "antd-style": "*",
    "lucide-react": "*",
    "react": "*",
    "react-i18next": "*"
  },
  "private": true,
  "version": "1.0.0"
}
```

**Why peer not direct deps for client libs:** the `./` and `./executionRuntime` entry points must be importable from server code. Listing React etc. as peer deps prevents bundlers from following them when only the runtime is consumed.

**Skip `./executor`** if the package has no frontend executor (server-only tools like `builtin-tool-web-browsing`).

---

## 9. Common Pitfalls

| Symptom                                                 | Likely cause                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| "ApiNotFound" at runtime                                | Method name in executor doesn't match `ApiName` value (typo, wrong case)                                |
| Method works once, then "this is undefined"             | Method declared as `async fn() {}` instead of `fn = async () => {}` — `this` lost when registry invokes |
| Debug "Response" pane blank but `pluginState` populated | Returning `content: ''` or letting `output.content` be undefined — use the `toResult` funnel            |
| Partial result vanishes on failure                      | `toResult` discarded `state` when `success: false`; preserve it                                         |
| Tool shows up but doesn't run on desktop                | `executors` in manifest doesn't include `'client'` (or vice versa for server-only)                      |
| Same tool registered twice / legacy identifier ghost    | Identifier collision; check `@deprecated` aliases in `inspectors.ts`/`renders.ts`                       |
| Manifest test fails after adding API                    | Forgot to add the corresponding i18n `apiName.<api>` key                                                |
| TypeScript error on `BaseExecutor<typeof X>`            | `X` declared with `enum` instead of `as const` object — must be the const-object form                   |
