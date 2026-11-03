# Composition — Shared Components & Package API

## `client/components/` — Shared Subcomponents

Cross-cutting building blocks used by multiple surfaces live here, not duplicated in each surface folder.

Examples from `web-browsing/src/client/components/`:

- `CategoryAvatar.tsx` — search category icon
- `EngineAvatar.tsx` — search engine logo (used in Inspector chip + Render list + Portal header)
- `SearchBar.tsx` — editable query bar (used in Render and Portal)

Examples from `local-system/src/client/components/`:

- `FileItem.tsx` — single file row (used in ListFiles Render, SearchFiles Render, MoveLocalFiles Render)
- `FilePathDisplay.tsx` — path with truncation (used everywhere)

### Rules

- Live under `client/components/`, exported via `client/components/index.ts`.
- Re-export from `client/index.ts` only if other packages need them; otherwise keep internal.
- Keep them dumb — props in, JSX out, no store reads. The store reads belong in the surface that composes them.

---

## `client/index.ts` — Package Public API

Re-exports everything the registries need plus useful types/manifest:

```ts
// Inspector — required
export { TaskInspectors } from './Inspector';

// Render — only if any API has one
export { TaskRenders, CreateTaskRender, RunTasksRender } from './Render';

// Placeholder / Streaming / Intervention — only if used
export { LocalSystemListFilesPlaceholder, LocalSystemSearchFilesPlaceholder } from './Placeholder';
export { LocalSystemStreamings } from './Streaming';
export { LocalSystemInterventions } from './Intervention';

// Portal — single export per tool
export { default as WebBrowsingPortal } from './Portal';

// Reusable components if other packages need them
export { CategoryAvatar, EngineAvatar, SearchBar } from './components';

// Re-export manifest, identifier, types for convenience
export { TaskManifest, TaskIdentifier } from '../manifest';
export * from '../types';
```
