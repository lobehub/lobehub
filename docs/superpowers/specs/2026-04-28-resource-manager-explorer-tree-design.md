# ResourceManager ExplorerTree Refactor - Design

Status: Draft (brainstormed 2026-04-28)
Owner: Innei
Branch base: `canary`

## Background

`src/features/ResourceManager/components/LibraryHierarchy/index.tsx` currently renders the knowledge-base sidebar tree through ResourceManager-specific row components. It uses `src/store/tree` for loaded children, expansion state, route navigation, optimistic move and rename behavior. The branch already contains a generic `src/features/ExplorerTree/` wrapper around `@pierre/trees`, but no ResourceManager consumer has migrated to it.

The refactor target is not a compatibility-preserving component swap. The target is a maintainability-oriented redesign that lets `ExplorerTree` become the generic tree interaction surface while ResourceManager owns its business tree controller. Existing behavior must remain complete: lazy loading, route selection, context menus, rename, internal tree DnD, external Explorer-list DnD into the sidebar, root drop, cache reconciliation, and mutation rollback.

## Goals

- Replace `LibraryHierarchy` and `HierarchyNode` with a thin ResourceManager wiring layer over `ExplorerTree`.
- Reshape `ExplorerTree` API where needed so it is controlled by stable node ids, not leaked `@pierre/trees` paths.
- Move ResourceManager tree state into a ResourceManager-specific controller or hook.
- Use backend `id` as the only business identity for tree state, selection, expansion, move, rename, and cache mutation.
- Keep route `slug` at the route/controller boundary only. Tree controller code must not reason about slugs.
- Support two independent DnD channels:
  - Sidebar tree internal DnD, handled by `ExplorerTree` and `@pierre/trees`.
  - Explorer list or masonry external drag into sidebar rows/root, handled by ResourceManager DnD protocol.
- Keep Sidebar tree selection separate from Explorer main-area selection.

## Non-goals

- Migrating the old `src/features/FileTree` consumers in SkillStore, AgentSkillDetail, AgentSkillEdit, or community skill pages.
- Preserving `src/store/tree` as a public global store API.
- Supporting manual sibling reorder in ResourceManager. ResourceManager keeps its existing folder-first and name-based sort policy.
- Moving ResourceManager-specific concepts such as `libraryId`, route slug, or Explorer `selectedFileIds` into the generic `ExplorerTree` API.

## Architecture

```text
┌──────────────────────────────┐
│ Route Boundary                │
│ libraryId + slug              │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ ResourceManager Controller    │
│ resolve slug -> folderId      │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ Resource Tree Controller      │
│ id-only state                 │
│ loaded tree snapshot          │
│ mutations + lazy loading      │
└───────┬────────────────┬─────┘
        ▼                ▼
┌──────────────┐   ┌────────────────┐
│ ExplorerTree │   │ External DnD    │
│ tree UI DnD  │   │ list -> sidebar │
└──────────────┘   └────────────────┘
```

| Layer                     | Responsibility                                                                                                                                      | Explicitly not responsible for                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Route/controller boundary | Parse route params, resolve `slug -> folderId`, provide current library/folder ids                                                                  | Tree rendering and tree UI state                                  |
| Resource tree controller  | Loaded children cache, loading status, expansion, Sidebar selection, mutation orchestration, route-selected folder sync, external drop coordination | Route slug semantics and row rendering                            |
| `ExplorerTree`            | Generic tree rendering, controlled selection/expansion, inline rename, internal DnD, context-menu host, row extension hooks                         | `libraryId`, ResourceManager routes, Explorer main-area selection |
| Explorer main area        | File list/masonry rendering, main-area multi-select, external DnD source                                                                            | Sidebar tree selection                                            |

## Identity Model

The business identity model is id-only:

```text
┌──────────────┐
│ Route slug   │
└──────┬───────┘
       ▼
┌──────────────┐
│ resolve id   │
└──────┬───────┘
       ▼
┌──────────────┐
│ Tree state   │
│ id only      │
└──────┬───────┘
       ▼
┌──────────────┐
│ ExplorerTree │
│ id API       │
└──────────────┘
```

`slug` remains useful for navigation output. A folder node may still carry `slug` as metadata so clicking the row can generate the canonical URL. It must not be used as the state key for selection, expansion, parent-child cache, move, rename, or delete.

## Data Model

| Model              | Shape                                                                                     | Notes                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `ResourceTreeNode` | `id`, `name`, `fileType`, `sourceType`, `url`, `metadata`, `parentId`, `slug`, `isFolder` | Business node. `id` is the only identity key. `slug` is route metadata.                                                                     |
| `TreeCache`        | `childrenByParentId: Map<string \| null, ResourceTreeNode[]>`                             | Use `null` as the root parent key internally. Convert to the API's `parentId: null` or legacy empty-string form only at service boundaries. |
| `LoadState`        | `statusByParentId: Record<string, 'idle' \| 'loading' \| 'revalidating' \| 'error'>`      | Supports row-level loading/error feedback.                                                                                                  |
| `TreeUiState`      | `expandedIds`, `selectedTreeIds`, `focusedId`                                             | Sidebar-only UI state. It is independent from Explorer main-area selection.                                                                 |
| `LoadedSnapshot`   | `ExplorerTreeNode<ResourceTreeNode>[]`                                                    | Derived from cache and expansion state. It contains only loaded nodes.                                                                      |

## State Flow

```text
┌─────────────────────┐
│ fileService          │
│ getKnowledgeItems    │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ TreeCache            │
│ childrenByParentId   │
│ statusByParentId     │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ deriveLoadedSnapshot │
│ id-only nodes        │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ ExplorerTree         │
│ render current tree  │
└─────────────────────┘
```

- Library switch clears cache, expansion, Sidebar selection, and focused id, then loads root.
- Route entry resolves the route slug into `folderId` and ancestor ids before calling the tree controller.
- Route-selected folder sync expands ancestor ids and loads any missing ancestor children.
- Expanding a folder updates `expandedIds`; if its children are not cached, the controller loads them.
- Collapsing a folder updates `expandedIds` only. Cached children remain cached.
- Explorer main-area refresh calls controller `reconcile(parentId, items)` for the visible parent rather than directly touching a global tree store.
- Mutation success revalidates affected parents through the controller. Mutation failure rolls back affected cache patches and revalidates defensively.
- Generation or epoch checks prevent stale async loads from writing into a different library after route/library changes.

## DnD Semantics

| Channel                    | Source                | Selection source                                                                 | Target resolution             | Mutation entry                                 |
| -------------------------- | --------------------- | -------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------- |
| Tree internal DnD          | Sidebar row           | `selectedTreeIds` if the dragged row is selected, otherwise dragged id           | `ExplorerTree.onMove` event   | `moveTreeItems(ids, oldParentId, newParentId)` |
| External drop into Sidebar | Explorer list/masonry | Explorer `selectedFileIds` if the dragged file is selected, otherwise dragged id | Row-level external drop props | `moveExternalItems(ids, toParentId)`           |
| External drop into root    | Header/root zone      | Explorer `selectedFileIds` if the dragged file is selected, otherwise dragged id | Root drop zone                | `moveExternalItems(ids, null)`                 |

```text
┌───────────────────────┐
│ Tree internal drag     │
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ ExplorerTree.onMove    │
│ sourceIds/newParentId  │
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ moveTreeItems          │
│ optimistic cache patch │
└───────────────────────┘

┌───────────────────────┐
│ Explorer list drag     │
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ ResourceManager DnD    │
│ external drop props    │
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ moveExternalItems      │
│ shared mutation helper │
└───────────────────────┘
```

Rules:

- Internal tree DnD and external Explorer-list DnD are separate input channels. They may share mutation helpers, but they do not share selection state.
- Tree selection is scoped to the Sidebar tree. Explorer main-area selection is scoped to the Explorer area.
- Moving a node into itself or into one of its descendants is invalid.
- Same-parent reorder is not part of this refactor. If `@pierre/trees` reports an inside move, ResourceManager writes the new parent and then sorts by its business ordering.
- Optimistic cache patches only affect loaded parents. The controller must not fabricate unloaded children lists.
- Successful move revalidates old and new parents.
- Failed move rolls back cache patches, revalidates old and new parents, and shows the ResourceManager move error.

## ExplorerTree API

The generic API should be id-oriented and controlled where ResourceManager needs control.

| API                                                     | Purpose                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `nodes`                                                 | Loaded tree snapshot.                                                                        |
| `selectedIds`, `defaultSelectedIds`, `onSelectedChange` | Controlled or uncontrolled selection. ResourceManager uses controlled mode.                  |
| `expandedIds`, `defaultExpandedIds`, `onExpandedChange` | Controlled or uncontrolled expansion. ResourceManager uses controlled mode for lazy loading. |
| `onNodeClick(node, event)`                              | Business-defined folder navigation or file opening.                                          |
| `onMove(event)`                                         | Internal tree DnD.                                                                           |
| `canDrag(node)`                                         | Per-node drag eligibility.                                                                   |
| `canDrop({ sourceIds, targetId, targetNode })`          | Drop validity, including descendant checks.                                                  |
| `onCommitRename(node, newName)`                         | Inline rename.                                                                               |
| `getContextMenuItems(node)`                             | Context menu items.                                                                          |
| `getRowProps(node)`                                     | Generic row DOM props. ResourceManager uses it for external drop attributes/events.          |
| `getRowMeta(node)`                                      | Lightweight row state, such as loading, error, active, or decoration hints.                  |
| `renderIcon(node, meta)`                                | Optional icon renderer for ResourceManager file icons and page emoji.                        |
| `renderLabel(node, meta)`                               | Optional label renderer for future highlighting/search.                                      |
| `getChildrenLoadState(node)`                            | Folder children loading/error indication.                                                    |

`ExplorerTree` may keep path mapping internally for `@pierre/trees`, but the public contract must expose ids and nodes. ResourceManager must not depend on path values.

## Component and Module Split

| Module                                                               | Responsibility                                                                                             |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/features/ExplorerTree/types.ts`                                 | Generic API and event types.                                                                               |
| `src/features/ExplorerTree/adapter/*`                                | id/path normalization and `@pierre/trees` mapping.                                                         |
| `src/features/ExplorerTree/view/ExplorerTree.tsx`                    | Model binding and controlled state bridge.                                                                 |
| `src/features/ExplorerTree/view/RowBridge.tsx`                       | Row props, meta, icon, label, and decoration bridge if the library surface requires a wrapper.             |
| `src/features/ResourceManager/tree/useResourceTreeController.ts`     | ResourceManager tree state, loading, selection, expansion, route-selected folder sync, mutation callbacks. |
| `src/features/ResourceManager/tree/deriveLoadedTree.ts`              | Cache to `ExplorerTreeNode[]` derivation.                                                                  |
| `src/features/ResourceManager/tree/mutations.ts`                     | Shared move, rename, delete, rollback, and revalidation helpers.                                           |
| `src/features/ResourceManager/components/LibraryHierarchy/index.tsx` | Thin wiring component that connects controller and `ExplorerTree`.                                         |

`src/features/ResourceManager/components/LibraryHierarchy/HierarchyNode.tsx` should be removed after the new `LibraryHierarchy` wiring covers its responsibilities. `src/store/tree` should be removed or folded into the ResourceManager tree domain if no other consumers remain.

## Error Handling

| Scenario                      | Handling                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Root load failure             | Keep existing cache if any, show recoverable error state, and allow retry.                                             |
| Folder children load failure  | Keep folder expanded, mark row or children state as error, and allow retry.                                            |
| Slug resolution failure       | Route/controller returns to library root and clears tree selection.                                                    |
| Rename failure                | Roll back node name, keep rename context where feasible, and show ResourceManager rename error.                        |
| Tree internal move failure    | Roll back tree cache, revalidate old/new parents, and show move error.                                                 |
| External drop failure         | Roll back tree cache and file-store optimistic effects where applicable, keep Explorer selection, and show move error. |
| Library switch during request | Ignore stale results through generation/epoch checks.                                                                  |

## Testing Strategy

| Target                    | Behavioral coverage                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `deriveLoadedTree`        | Cache plus expanded ids produce the correct snapshot; unloaded children are not fabricated.                                            |
| Resource tree controller  | Init, root load, expand/load, route-selected folder sync, reconcile, rename, move, delete, and rollback.                               |
| DnD mutation helpers      | Internal multi-select move, external Explorer selection move, self-target rejection, descendant-target rejection.                      |
| Route boundary            | Slug resolves to id before tree controller calls; controller receives no slug input.                                                   |
| `LibraryHierarchy` wiring | Controlled selection/expansion, context menu, rename, external drop props, and click navigation.                                       |
| Regression behavior       | Tree selection and Explorer selection remain isolated; affected parents revalidate after mutation; stale library requests are ignored. |

Avoid low-signal tests that snapshot static constant tables, DOM class structures from `@pierre/trees`, or exported API field inventories without behavioral assertions.

Suggested validation commands:

```bash
bunx vitest run --silent='passed-only' 'src/features/ResourceManager/tree/**/*.test.ts'
bunx vitest run --silent='passed-only' 'src/features/ResourceManager/components/LibraryHierarchy/**/*.test.tsx'
bunx vitest run --silent='passed-only' 'src/store/tree/**/*.test.ts'
bun run type-check
```

If `src/store/tree` is removed, migrate the relevant regression tests into `src/features/ResourceManager/tree/` and drop the old store test command.

## Migration Plan

```text
┌────────────────────────────┐
│ 1. Reshape ExplorerTree API │
│ controlled ids + row slots  │
└──────────────┬─────────────┘
               ▼
┌────────────────────────────┐
│ 2. Create RM tree domain    │
│ controller + derive + tests │
└──────────────┬─────────────┘
               ▼
┌────────────────────────────┐
│ 3. Replace LibraryHierarchy │
│ thin ExplorerTree wiring    │
└──────────────┬─────────────┘
               ▼
┌────────────────────────────┐
│ 4. Connect both DnD channels│
│ internal tree + external    │
└──────────────┬─────────────┘
               ▼
┌────────────────────────────┐
│ 5. Remove obsolete tree code│
│ HierarchyNode / useTreeStore│
└──────────────┬─────────────┘
               ▼
┌────────────────────────────┐
│ 6. Validate behavior        │
│ targeted tests + type-check │
└────────────────────────────┘
```

The implementation may be destructive within the approved scope. Compatibility with old ResourceManager tree internals is secondary to preserving complete ResourceManager business behavior and producing clearer long-term boundaries.
