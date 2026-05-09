---
name: builtin-tool
description: Build a new builtin tool package under `packages/builtin-tool-<name>/`. Use when adding a new agent-callable toolset, designing its API surface (manifest / ApiName / Params / State), implementing the Executor + ExecutionRuntime, building the Inspector / Render / Placeholder / Streaming / Intervention / Portal UI, or wiring a tool into the central registries (`packages/builtin-tools/src/{index,identifiers,inspectors,renders,placeholders,streamings,interventions,portals}.ts` and `src/store/tool/slices/builtin/executors/index.ts`). Triggers on "new builtin tool", "add a tool", "tool inspector", "tool render", "tool placeholder", "tool streaming", "tool intervention", "BuiltinToolManifest", "BaseExecutor", "ExecutionRuntime".
---

# Builtin Tool Authoring Guide

A builtin tool is a package the agent runtime can call. It ships **five faces**:

| Face                 | Lives in                                                                               | Audience                              |
| -------------------- | -------------------------------------------------------------------------------------- | ------------------------------------- |
| **Manifest + types** | `src/{manifest,types,systemRole}.ts`                                                   | The LLM (tool spec + system prompt)   |
| **ExecutionRuntime** | `src/ExecutionRuntime/`                                                                | Server / desktop / any runtime caller |
| **Executor**         | `src/client/executor/`                                                                 | Frontend (wraps stores/services)      |
| **Client UI**        | `src/client/{Inspector,Render,…}/`                                                     | Chat UI                               |
| **Registry wiring**  | `packages/builtin-tools/src/*.ts` + `src/store/tool/slices/builtin/executors/index.ts` | Framework                             |

---

## Read These First

| Question                                                                             | Doc                                |
| ------------------------------------------------------------------------------------ | ---------------------------------- |
| Where do files live? What does each face do? Wiring?                                 | [architecture.md](architecture.md) |
| How do I name the tool, design APIs, write the manifest, executor, ExecutionRuntime? | [tool-design.md](tool-design.md)   |
| How do I build Inspector / Render / Placeholder / Streaming / Intervention / Portal? | [ui.md](ui.md)                     |

---

## When to Use This Skill

- Creating a new `packages/builtin-tool-<name>/` package
- Adding a new API method to an existing builtin tool
- Building or restyling any of the 6 client surfaces for a tool
- Wiring a tool into the central registries
- Debugging "tool not found / API not found / render not showing / placeholder stuck" errors

---

## Top-Level Design Principles

1. **`lobe-<domain>` identifier is permanent.** It's stored in message history. Renames need `@deprecated` aliases (see `packages/builtin-tools/src/inspectors.ts:88-89`). Get it right the first time.
2. **ApiName is an `as const` object**, not a TS enum. It doubles as the runtime list `BaseExecutor` iterates over.
3. **Three result fields, three audiences:**
   - `content: string` → the LLM reads it
   - `state: Record<…>` → the UI's `pluginState`; **result-domain only**, never echo all params back
   - `error: { type, message, body? }` → both LLM and UI; `type` is a stable code
4. **Split execution from frontend wiring.**
   - `src/ExecutionRuntime/` — pure runtime, no React, no Zustand, accepts services via constructor. **The default place for new logic.**
   - `src/client/executor/` — `BaseExecutor` subclass that calls `ExecutionRuntime` (or stores/services directly when frontend-only).
5. **UI defaults to "do nothing".** Inspector is required (the header strip). Render/Placeholder/Streaming/Intervention/Portal are added **only when there's something specific to show** — empty registries are fine.
6. **Style with `createStaticStyles + cssVar.*`** (zero-runtime). Fall back to `createStyles + token` only when you genuinely need runtime values. Use `@lobehub/ui` components, not raw antd.
7. **i18n keys live in `src/locales/default/plugin.ts`.** Inspector titles must come from `t('builtins.<identifier>.apiName.<api>')` so something renders while args stream.

---

## Package Layout (preferred, post-2026 convention)

```
packages/builtin-tool-<name>/
├── package.json
└── src/
    ├── index.ts              # exports manifest + types + systemRole + Identifier (no React, no stores)
    ├── manifest.ts           # BuiltinToolManifest with JSON Schema for every API
    ├── types.ts              # ApiName const + Params/State interfaces per API
    ├── systemRole.ts         # System prompt teaching the model when/how to use the APIs
    ├── ExecutionRuntime/     # ✅ Default home for runtime logic (server- or anywhere-callable)
    │   └── index.ts
    └── client/
        ├── index.ts          # Re-exports for the registries
        ├── executor/         # ✅ Frontend executor — extends BaseExecutor, often delegates to ExecutionRuntime
        │   └── index.ts
        ├── Inspector/        # required — header chip per API
        ├── Render/           # optional — rich result card
        ├── Placeholder/      # optional — skeleton during streaming/execution
        ├── Streaming/        # optional — live output renderer (e.g. RunCommand, WriteFile)
        ├── Intervention/     # optional — approval / edit-before-run UI
        ├── Portal/           # optional — full-screen detail view
        └── components/       # shared subcomponents used by the surfaces above
```

**Older packages** (`builtin-tool-task`, `builtin-tool-calculator`, etc.) still have `src/executor/` as a sibling of `src/client/`. That's grandfathered; **don't relocate without a deliberate refactor**. New packages and new APIs added to existing packages should follow the layout above.

`package.json` exports map:

```json
"exports": {
  ".":                  "./src/index.ts",
  "./client":           "./src/client/index.ts",
  "./executor":         "./src/client/executor/index.ts",
  "./executionRuntime": "./src/ExecutionRuntime/index.ts"
}
```

---

## Authoring Checklist

Before opening the PR:

- [ ] Identifier follows `lobe-<domain>` and is **stable** (lives in message history).
- [ ] Every `<Name>ApiName` value has: a manifest `api[]` entry, an executor method, an Inspector, an i18n `apiName.*` key.
- [ ] `Params` interfaces match the JSON Schema; `State` interfaces match what the executor returns and what the UI surfaces read.
- [ ] System prompt disambiguates confusable APIs and points to batch variants.
- [ ] Runtime logic lives in `ExecutionRuntime/`; the `client/executor/` only wires stores/services and delegates.
- [ ] Executor returns `{ success, content, state, error? }` via a single `toResult()` funnel — `content` always non-empty (default to `error.message`).
- [ ] Inspector handles `isArgumentsStreaming`, `isLoading`, `partialArgs`, missing `pluginState`.
- [ ] Render returns `null` until it has data; only created for APIs with rich results.
- [ ] Placeholder added if the API has a perceivable execution lag (search, list, crawl).
- [ ] Streaming added for APIs that emit incremental output (run command, write file, code execution).
- [ ] Intervention added if `humanIntervention` is set in the manifest.
- [ ] All registry files updated (see [architecture.md → Registry wiring](architecture.md#registry-wiring)).
- [ ] i18n keys in `src/locales/default/plugin.ts` plus dev seeds in `en-US`/`zh-CN`.
- [ ] `bunx vitest run --silent='passed-only' 'packages/builtin-tool-<name>'` passes.
- [ ] `bun run type-check` passes.

---

## Reference Tools

Pick the closest neighbor and copy:

| If your tool is…                                                        | Read first                                                                                                     |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Pure-compute, no UI state                                               | `packages/builtin-tool-calculator/` — `ExecutionRuntime` reuses executor (mathjs/nerdamer work everywhere)     |
| CRUD over a domain entity                                               | `packages/builtin-tool-task/` — full Inspector + Render set, batch variants                                    |
| Heavy UI (Inspector/Render/Placeholder/Portal)                          | `packages/builtin-tool-web-browsing/` — search-style result UI, Portal for detail view                         |
| Desktop / filesystem with all surfaces (incl. Streaming + Intervention) | `packages/builtin-tool-local-system/` — `ExecutionRuntime` injects an `ILocalSystemService`, executor calls it |
| Server-side pure (no client executor)                                   | `packages/builtin-tool-web-browsing/` — only `ExecutionRuntime` is exported; the chat client doesn't run it    |
| Needs human approval before running                                     | `packages/builtin-tool-local-system/src/client/Intervention/` — per-API approval components                    |
