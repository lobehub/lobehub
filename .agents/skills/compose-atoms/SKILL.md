---
name: compose-atoms
description: 'Decompose a heavy domain feature into mountable capability atoms. Use when a Viewer/Page/index.tsx owns fetch, filters, mutations, modals, and host integrations together; a visual split still leaves store calls and actions on the page; a portal, embed, share, mobile, or micro-app needs a subset of the same domain; or a new capability is landing as another `readOnly`/`mode`/`variant` flag. Triggers on `compose-atoms`, sink state, 状态下沉, 重业务拆分, 拆成原子, 原子组件, 组装, god component, fat viewer, module graph, slot composition, host seam.'
user-invocable: false
---

# Compose Atoms

A heavy domain is a **kit**, not a viewer with modes. Each host is an import list. An atom owns the data, actions, and dependencies of one capability. The assembler only chooses what to mount.

This is a **module-graph** split. Hiding UI does not drop a module. A host that never imports a file is the only host that does not ship it.

Do not use this skill to slice one component into smaller files. That is `react`.

## When

The folder is a product surface (Conversation, Acceptance, Document, Verify, Task, …) and at least one of these is true:

- One entry owns read + write + workflow + host integration.
- A second host already exists or is the next change (page, portal, share, mobile, popup, micro-app).
- The next feature is another boolean / `mode` / `variant` on the fat tree.
- Reusing a header, list, or card would import trays, stores, or chat.

If the file is large but has **one** capability and **one** host, stop. Use `react`.

## Grain

An atom is the **smallest unit a host is allowed not to mount**.

Ask, for every chunk: _would any host ship the rest and skip this?_ If yes, it is an atom. If no, it stays inside its parent.

That grain is coarser than a visual section and finer than the whole page.

| Too coarse                         | Right grain                         | Too fine                                      |
| ---------------------------------- | ----------------------------------- | --------------------------------------------- |
| One `Viewer` with `readOnly`       | Identity, goal, list, decision, …   | Every badge, row, and icon as a public export |
| `Chat` as a single import          | List, composer, intervention, …     | Every message sub-row the page then rewires   |
| `Document` as editor + every panel | Canvas, header, comments as omitted | Internal toolbar buttons                      |

A **workflow** (focus review, thread, publish) is one atom to hosts that skip the whole mode. Inside it, keep splitting only if a host would mount a piece of that workflow alone.

## Sink State

The split is worthless if the assembler still holds the domain state. **Imports follow the hook.** A `useStore` / `useX` / `handleAccept` left on the page keeps that module (and everything it imports) on every host that mounts the page.

Sink everything the atom needs into the atom:

| Sinks into the atom                        | Stays on the assembler                        |
| ------------------------------------------ | --------------------------------------------- |
| Resource fetch                             | The record id / scope identity                |
| Derived view model (counts, labels, scope) | Which atoms are mounted (the import list)     |
| Transient UI (filter, collapse, pending)   | Host layout state (focused vs overview, rail) |
| Mutation handlers and their stores/modals  | Host seams (provider value the runtime owns)  |

```tsx
// wrong — visual split, state still on the page
const Page = () => {
  const { data, mutate } = useX(id);
  const [filter, setFilter] = useState('all');
  const accept = () => void mutate(...);
  return (
    <>
      <Identity data={data} />
      <List data={data} filter={filter} onFilter={setFilter} />
      <DecisionBar onAccept={accept} />
    </>
  );
};

// right — each atom reads and acts; page only assembles
const Page = () => (
  <Scope id={id}>
    <Identity />
    <List />
    <Decision />
  </Scope>
);
```

Do not lift "to fetch once" or "so siblings share data". Two atoms calling the same SWR hook share the cache by key. Sibling writes go through that cache (or a store slice the write atom imports), not through page `useState`.

Lift only when the state **is** the assembler's job: which workflow is on screen, whether a rail is open. If a value is used to render or mutate one capability, it belongs in that capability.

## Kit

| Piece            | Owns                                              | Must not own                                       |
| ---------------- | ------------------------------------------------- | -------------------------------------------------- |
| Domain primitive | Types, predicates, formatters                     | React, stores, services                            |
| Data access      | One resource, one file                            | Sibling list / infinite / document hooks           |
| Read atom        | Present + local UI state + its own fetch          | Mutations, trays, owner services, host stores      |
| Write atom       | One mutation and its UI                           | Page layout, unrelated writes                      |
| Workflow atom    | A mode assembled from other atoms                 | Becoming the only entry other hosts can import     |
| Domain slot      | `ReactNode` hole for another **same-domain** atom | A callback whose implementation lives in this file |
| Host seam        | Optional host-provided UI, **null by default**    | A fallback that imports the host graph             |
| Assembler        | Layout + the import list                          | Domain actions; domain fetch except local chrome   |

A visual block that both reads and writes is a read atom + a write atom, joined by a domain slot.

Two seam types — do not mix them:

- **Domain slot** — same feature, optional capability (`editSlot`, `toolbar`). The host imports the write atom and passes it in.
- **Host seam** — only some runtimes can resolve it (chat store, topic drawer, Electron). Context default is `null`. The micro-app / share page never imports the provider value. See `split-micro-app` for the runtime cut.

## Ownership

State and imports live in the atom that needs them.

- Read atoms call the isolated resource hook. Filter / collapse / expand stay in the atom.
- Write atoms call the same hook, then mutate. They import their own modals and services. They return `null` when the record is not writable.
- Workflow atoms compose other atoms. They still do not become the light host's entry.
- Assemblers do not fetch in order to push props down. Chrome unique to that host (a title in a shell header) may read the hook.
- Scope context carries **identity** (`id`, `embedded`). It does not carry actions, stores, or modal openers.

Several atoms calling the same SWR hook is expected. SWR dedupes on key. Do not lift data to the assembler "to fetch once".

The shared read hook is **its own file**. A light host imports that file, never a `hooks.ts` / store barrel that also exports list, document, or send-message.

```ts
// any host:
import { useX } from '@/features/Domain/useX';

// never from a light host:
import { useX } from '@/features/Domain/hooks';
import { DomainViewer } from '@/features/Domain';
```

A flag that only changes behavior of code already in the atom is fine. A flag whose purpose is to skip importing another module is not — that module is a slot or a sibling the assembler omits.

`dynamic(() => import(...))` only helps when **no static import** of that module remains on the light graph.

## Assembler

A host is its import list.

```tsx
// light host — deep imports only
<Scope id={id}>
  <ReadA />
  <ReadB />
</Scope>

// full host — same reads, write atoms in slots, workflows as siblings
<ReadA extra={<WriteA />} />
<ReadB toolbar={<WriteB />} />
<Workflow />
<WriteC />
```

Route / portal files compose host skeleton (providers, host seams). Do not add a wrapper page whose only job is to sit between the route and the assembler.

The feature barrel may export the **full** assembler for in-app use. Light hosts must not import that barrel.

## Procedure

1. List **hosts** (page, portal, share, mobile, popup, micro-app — include the next one).
2. List **capabilities as verbs** (view identity, edit field, decide, open host thing). Map host → verbs.
3. Set **grain**: each verb a host can skip is an atom. Group the rest under a parent.
4. Extract primitives and the isolated read hook first.
5. Extract read atoms. Optional same-domain capabilities become `ReactNode` slots, not callbacks that close over write modules.
6. Extract each write / workflow atom into its own file. Heavy deps stay in that file.
7. **Sink state.** Move fetch, view-model, transient UI, and handlers out of the assembler. If the page still calls a domain hook to feed props, the split is not done.
8. Rewrite every host as an import list plus layout. Delete `readOnly` / `isPublic` / `mode` / `variant` on the fat tree.
9. Point light hosts at atoms by **deep path**.
10. Prove the cut. Grep the light entry's import tree, or trace a module the light host must not ship. A missing button is not proof.

```bash
# example: light host must not import a write atom
WORKBENCH_TRACE_MODULE=features/Verify/Acceptance/AcceptanceDecision bun run build:rr
```

If the light assembler appears on the importer chain, a static import still exists — usually a barrel, a leftover flag, or actions left on the page.

## Example

`src/features/Verify/Acceptance/` is one application of this kit, not the template to copy file-for-file.

| Host                          | Mounts                                                                    |
| ----------------------------- | ------------------------------------------------------------------------- |
| In-app `Acceptance/index.tsx` | Identity, goal, inventory, decision, focus workflow, ledger + write slots |
| Workbench public detail       | Identity, goal, inventory only                                            |
| Portal                        | Full assembler + `OriginConversationProvider`                             |

Read `AcceptanceGoal` (read + `editSlot`) and `AcceptanceGoalEdit` (write) for the slot cut. Read `originConversation.tsx` for a host seam. Read workbench `AcceptanceDetail.tsx` for a light assembler.

## Related skills

- **`react`**: single-surface boundaries, styling, memoization.
- **`split-micro-app`**: worker / SSR / gateway / stubs. This skill is how the shared UI is cut afterwards.
- **`spa-routes`**: route files stay thin assemblers.
- **`data-fetching-architecture`**: how the isolated hook fetches, not where a host may import it from.
- **`zustand`**: narrow selectors inside an atom; do not put the whole store on scope context.
