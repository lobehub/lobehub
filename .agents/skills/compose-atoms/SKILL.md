---
name: compose-atoms
description: 'Split a shared feature into capability atoms so each surface only imports what it mounts. Use when the same domain UI is assembled on more than one surface (in-app workspace vs public SSR vs portal), a micro-app is inheriting a heavy viewer, a readOnly/isPublic/variant flag is hiding owner actions, or a visual split still leaves actions and store calls on the page. Triggers on `compose-atoms`, `readOnly`, tree-shake, 原子组件, 拆成原子, 组装, module graph, slot composition, AcceptanceViewer, workbench public page.'
user-invocable: false
---

# Compose Atoms

Canonical living example: `src/features/Verify/Acceptance/` assembled by the in-app page (`index.tsx`) and the public workbench page (`apps/workbench/src/features/acceptance/AcceptanceDetail.tsx`). Read those files when in doubt — this skill records the rules, not copies of the JSX.

This is a **module-graph** split. Hiding a button does not remove a module. Only a surface that never imports a file can drop that file from its bundle.

Do not use this skill to slice a single-surface component into smaller files. That case is owned by the `react` skill.

## When this applies

The same domain has (or is about to have) more than one assembler:

| Surface                    | What it may mount                                                            |
| -------------------------- | ---------------------------------------------------------------------------- |
| In-app / portal            | Full capability: identity, goal, list, owner writes, decision, focus, ledger |
| Public / share / micro-app | A subset: identity, read-only goal, list                                     |

If there is only one assembler and no bundle boundary, stop. `react` still says: do not split solely to make files smaller.

## What does not work

| Move                                                                      | Why the bundler still keeps the heavy module                   |
| ------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `readOnly` / `isPublic` / `variant` on the fat page                       | Flags change runtime, not the static import graph              |
| Split JSX, leave hooks and actions on the page                            | The page file still imports DecisionBar, modals, trays, stores |
| Optional callback (`onEdit?`) implemented in the same file as the read UI | The write implementation is already in that module             |
| Light surface imports the fat `index.tsx` / feature barrel                | Evaluating the barrel evaluates sibling exports                |
| Shared hook lives in a barrel next to list / document / infinite hooks    | Importing the hook pulls the barrel                            |

`dynamic(() => import(...))` only helps when **no static import** of that module remains on the light graph.

## Capability, not section

Split on **what a surface is allowed to do**, not on visual bands.

```
read atom     — present data; own its fetch and local UI state
write atom    — mutate; own its pending state and side-effect imports
assembler     — import atoms, place them, pass slots; no domain actions
```

A visual section that both reads and writes is two atoms, composed with a slot.

```
AcceptanceGoal          read: requirement, collapse
  editSlot              write: AcceptanceGoalEdit → GoalModal
  reportSlot            write/nav: AcceptanceViewReportLink

AcceptanceIdentity      read: title, origin, counts
  statusSlot            write: AcceptanceStatusControl
  topicSlot             app-only: AcceptanceOriginTopic

AcceptanceCheckInventory  read: list, filter, expand
  toolbar               write: AcceptanceCheckOwnerToolbar
```

Flags that only change behavior of code already in the atom (`canReview` on rows) are fine. Flags that exist so the atom can skip importing another module are not — that other module must be a slot or a sibling the assembler chooses not to import.

## Ownership

Each atom owns the state and imports its capability needs.

- **Read atoms** call the isolated read hook themselves. Transient UI state (filter, collapse, expand) lives in the atom, not the assembler.
- **Write atoms** call the same read hook for the current record, then mutate. They import trays, modals, and owner services. They return `null` when the record is not writable.
- **Assembler** does not call the domain hook to feed props into atoms. It may read the hook only for chrome that is unique to that surface (workbench header title).
- **Scope context** may carry identity (`acceptanceId`, `embedded`). It must not carry actions, stores, or modal openers.

Multiple atoms calling the same SWR hook is expected. SWR dedupes on key. Do not lift the data to the assembler "to fetch once".

Put the shared read hook in **its own file**. Light surfaces import that file, never a feature `hooks.ts` that also exports list / document / infinite helpers.

```ts
// light and full both:
import { useAcceptanceBundle } from '@/features/Verify/Acceptance/useAcceptanceBundle';

// never from a light surface:
import { useAcceptanceBundle } from '@/features/Verify/hooks';
import { AcceptanceViewer } from '@/features/Verify';
```

## Assemblers

A surface is an import list. If a file is not in that list, it is not in the bundle.

```tsx
// public / workbench — deep imports only
<AcceptanceScope acceptanceId={id}>
  <AcceptanceBundleGate>
    <AcceptanceIdentity />
    <AcceptanceGoal />
    <AcceptanceCheckInventory />
  </AcceptanceBundleGate>
</AcceptanceScope>

// in-app page — same reads, plus write atoms in slots
<AcceptanceIdentity
  statusSlot={<AcceptanceStatusControl />}
  topicSlot={<AcceptanceOriginTopic />}
/>
<AcceptanceGoal
  editSlot={<AcceptanceGoalEdit />}
  reportSlot={<AcceptanceViewReportLink />}
/>
<AcceptanceCheckInventory canReview toolbar={<AcceptanceCheckOwnerToolbar />} />
<AcceptanceDecision />
```

Route files compose the surface skeleton (providers, slots the app owns such as `OriginConversationProvider`). Do not add a wrapper page whose only job is to sit between the route and the assembler.

App-only capabilities that a micro-app cannot even resolve (chat store, topic drawer) stay behind a **null default context seam** (`originConversation.tsx`). The micro-app never imports the provider value. That is the `split-micro-app` slot-inject cut; this skill owns the component-level equivalent.

## Procedure

1. List surfaces and the capabilities each one is allowed to mount. Stop if there is only one surface.
2. Draw the import graph of the fat entry. Anything the light surface must not ship becomes a write atom or an app-only slot.
3. Extract read atoms first. Move the read hook into its own file. Give optional capabilities `ReactNode` slots, not callbacks that close over write modules.
4. Extract each write atom into its own file. The atom imports its own heavy deps.
5. Rewrite each assembler as an import list plus layout. Delete `readOnly` / `isPublic` / `variant` on the fat tree.
6. Point the light surface at the atoms by **deep path**. Confirm it does not import `index.tsx` or the feature barrel.
7. Prove the cut with a module trace, not with a screenshot of a missing button.

```bash
# workbench example — expect no DecisionBar / GoalModal / chat store from the public page
WORKBENCH_TRACE_MODULE=features/Verify/Acceptance/AcceptanceDecision bun run build:rr
WORKBENCH_TRACE_MODULE=features/Conversation/ChatInput/VerifyTray/GoalModal bun run build:rr
```

The trace must not list the light assembler as an importer. If it does, a static import still exists — usually a barrel, a leftover flag-era import, or state left on the page.

## Related skills

- **`react`**: single-surface component boundaries, styling, memoization. Do not use `compose-atoms` to shrink one file.
- **`split-micro-app`**: worker / SSR / gateway / stub / `.client.tsx`. After the app exists, this skill is how shared UI is cut so the worker does not inherit the in-app graph.
- **`spa-routes`**: route files stay thin assemblers.
- **`data-fetching-architecture`**: how the isolated read hook should fetch (service + SWR), not where it may be imported from.
