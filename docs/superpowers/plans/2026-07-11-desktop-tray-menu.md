# Desktop Tray Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both tray mouse buttons open a native menu containing Pinned pages, Recent Agents, Recent pages, and explicit quick/application actions while keeping Quick Composer available through its menu item and global shortcut.

**Architecture:** The renderer resolves workspace-aware page and agent metadata and pushes a serializable snapshot through typed Electron IPC. The main process caches that snapshot, rebuilds one shared cross-platform native menu, and uses existing broadcasts for navigation and creation actions. Dynamic data failure degrades to the static action menu.

**Tech Stack:** Electron native `Tray`/`Menu`, TypeScript, React 19, Zustand, typed `@lobechat/electron-client-ipc`, Vitest.

## Global Constraints

- Left-click and right-click open the same native tray menu; double-click has no separate action.
- Quick Composer remains an explicit menu action and retains `Alt+Shift+Space` as its default global shortcut.
- Show at most 3 Pinned pages, 3 Recent Agents, and 5 Recent pages; omit empty dynamic sections.
- Recent Agent selection restores its most recent route and never creates a topic.
- New Chat is the only tray action that creates a conversation.
- Main process code treats renderer-provided internal URLs as opaque and never queries application databases.
- Do not add usage/quota information, a custom tray window, or screenshot workflow changes.

---

## File Structure

| File                                                         | Responsibility                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| `packages/electron-client-ipc/src/types/tray.ts`             | Serializable tray snapshot contracts                           |
| `packages/electron-client-ipc/src/events/navigation.ts`      | Renderer broadcasts for opening Recently Viewed and All Agents |
| `apps/desktop/src/main/core/ui/Tray.ts`                      | Uniform left/right tray mouse behavior and cached menu popup   |
| `apps/desktop/src/main/core/ui/TrayManager.ts`               | Snapshot ownership and menu rebuild orchestration              |
| `apps/desktop/src/main/menus/trayMenu.ts`                    | Shared native menu template composition                        |
| `apps/desktop/src/main/menus/impls/{macOS,windows,linux}.ts` | Delegate tray menu creation to shared builder                  |
| `apps/desktop/src/main/controllers/TrayMenuCtr.ts`           | Typed renderer-to-main snapshot update method                  |
| `src/services/electron/tray.ts`                              | Renderer IPC service for tray snapshot updates                 |
| `src/features/Electron/titlebar/TrayMenu/useTrayMenuSync.ts` | Resolve and push pages/agents; respond to tray More commands   |
| `src/features/Electron/titlebar/NavigationBar.tsx`           | Mount synchronization and expose Recently Viewed state         |

---

### Task 1: Typed tray snapshot and renderer commands

**Files:**

- Modify: `packages/electron-client-ipc/src/types/tray.ts`
- Modify: `packages/electron-client-ipc/src/events/navigation.ts`
- Test: `apps/desktop/src/main/controllers/__tests__/TrayMenuCtr.test.ts`
- Modify: `apps/desktop/src/main/controllers/TrayMenuCtr.ts`

**Interfaces:**

- Produces: `TrayNavigationItem`, `TrayAgentItem`, and `TrayNavigationSnapshot`.

- Produces: `TrayMenuCtr.updateNavigationSnapshot(snapshot): { success: true }`.

- Produces broadcasts: `openRecentlyViewed(): void` and `openAllAgents(): void`.

- [ ] **Step 1: Write the failing controller test**

Add a test that calls `updateNavigationSnapshot` with one agent, pinned page, and recent page, then expects `trayManager.updateNavigationSnapshot(snapshot)` and `{ success: true }`.

```ts
const snapshot = {
  agents: [{ id: 'agent-1', title: 'Researcher', url: '/agent/agent-1' }],
  pinned: [{ title: 'Pinned task', url: '/tasks/pinned' }],
  recent: [{ title: 'Recent page', url: '/page/recent' }],
};

expect(trayMenuCtr.updateNavigationSnapshot(snapshot)).toEqual({ success: true });
expect(mockApp.trayManager.updateNavigationSnapshot).toHaveBeenCalledWith(snapshot);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd apps/desktop && bunx vitest run --silent='passed-only' src/main/controllers/__tests__/TrayMenuCtr.test.ts`

Expected: FAIL because `updateNavigationSnapshot` does not exist.

- [ ] **Step 3: Add contracts and the minimal controller method**

Add the exact serializable interfaces to `types/tray.ts`, add the two parameterless events to `NavigationBroadcastEvents`, and implement:

```ts
@IpcMethod()
updateNavigationSnapshot(snapshot: TrayNavigationSnapshot) {
  this.app.trayManager.updateNavigationSnapshot(snapshot);
  return { success: true as const };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Task 1 Vitest command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/electron-client-ipc/src/types/tray.ts packages/electron-client-ipc/src/events/navigation.ts apps/desktop/src/main/controllers/TrayMenuCtr.ts apps/desktop/src/main/controllers/__tests__/TrayMenuCtr.test.ts
git commit -m "✨ feat(desktop): add typed tray navigation snapshot"
```

### Task 2: Uniform tray clicks and shared native menu

**Files:**

- Create: `apps/desktop/src/main/menus/trayMenu.ts`
- Create: `apps/desktop/src/main/menus/trayMenu.test.ts`
- Modify: `apps/desktop/src/main/menus/types.ts`
- Modify: `apps/desktop/src/main/menus/impls/macOS.ts`
- Modify: `apps/desktop/src/main/menus/impls/windows.ts`
- Modify: `apps/desktop/src/main/menus/impls/linux.ts`
- Modify: `apps/desktop/src/main/core/ui/TrayManager.ts`
- Modify: `apps/desktop/src/main/core/ui/Tray.ts`
- Modify: `apps/desktop/src/main/core/ui/__tests__/Tray.test.ts`
- Modify: platform menu tests under `apps/desktop/src/main/menus/impls/*.test.ts`

**Interfaces:**

- Consumes: `TrayNavigationSnapshot` from Task 1.

- Produces: `buildTrayMenuTemplate(app, snapshot): MenuItemConstructorOptions[]`.

- Produces: `TrayManager.updateNavigationSnapshot(snapshot): void`.

- [ ] **Step 1: Write failing behavior tests for menu composition**

Test labels and callbacks, not the full object literal. Assert section omission on empty data, limits of 3/3/5, `showMainWindow()` plus `broadcast('navigate', { escape: true, path })` for dynamic items, `createNewTopic` for New Chat, and static actions when the snapshot is empty.

- [ ] **Step 2: Write failing tray mouse tests**

Trigger Electron's registered `click`, `right-click`, and `double-click` handlers. Expect click and right-click to each call `popUpContextMenu` once; expect no call to `screenCaptureManager.startSession` and no double-click call to `showMainWindow`.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
cd apps/desktop && bunx vitest run --silent='passed-only' src/main/menus/trayMenu.test.ts src/main/core/ui/__tests__/Tray.test.ts
```

Expected: FAIL because the shared builder and unified click behavior do not exist.

- [ ] **Step 4: Implement the shared menu builder**

Use small helpers `createSection(label, items)` and `openRoute(app, url)`. Compose sections in this order: Pinned, Recent Agents, Recent, Quick Actions, Application, Quit. Use `accelerator: 'Alt+Shift+Space'` on Quick Composer and existing i18n labels for application actions. Add new tray locale keys for `pinned`, `recentAgents`, `recent`, `more`, `moreAgents`, and `newChat` in the desktop menu locale source.

- [ ] **Step 5: Delegate all platforms and rebuild through TrayManager**

Change `IMenuPlatform.buildTrayMenu` to accept an optional snapshot. Each platform calls the shared builder. `TrayManager` stores an empty default snapshot and, on update, calls `mainTray.setMenu(this.app.menuManager.buildTrayMenu(snapshot))`.

- [ ] **Step 6: Simplify Tray mouse behavior**

Remove `CLICK_DEBOUNCE_MS`, `_clickTimer`, `onDoubleClick`, and the double-click listener. Both click listeners call one private `popUpMenu()` method that guards `_contextMenu` and `_tray` before invoking `popUpContextMenu`.

- [ ] **Step 7: Run desktop tray/menu tests and verify GREEN**

Run:

```bash
cd apps/desktop && bunx vitest run --silent='passed-only' src/main/menus/trayMenu.test.ts src/main/core/ui/__tests__/Tray.test.ts src/main/menus/impls/macOS.test.ts src/main/menus/impls/windows.test.ts src/main/menus/impls/linux.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/core/ui apps/desktop/src/main/menus apps/desktop/src/main/locales/default/menu.ts apps/desktop/resources/locales/en/menu.json
git commit -m "✨ feat(desktop): redesign native tray menu"
```

### Task 3: Resolve and synchronize Recent Agents and pages

**Files:**

- Create: `src/features/Electron/titlebar/TrayMenu/resolveSnapshot.ts`
- Create: `src/features/Electron/titlebar/TrayMenu/resolveSnapshot.test.ts`
- Create: `src/features/Electron/titlebar/TrayMenu/useTrayMenuSync.ts`
- Create: `src/features/Electron/titlebar/TrayMenu/useTrayMenuSync.test.tsx`
- Create: `src/services/electron/tray.ts`
- Modify: `src/features/Electron/titlebar/NavigationBar.tsx`

**Interfaces:**

- Consumes: resolved `pinnedPages`, `recentPages`, `homeAgentListSelectors.allAgents`, and `activeRecentScope`.

- Produces: `resolveTrayNavigationSnapshot({ agents, pinnedPages, recentPages, scope })`.

- Calls: `desktopTrayService.updateNavigationSnapshot(snapshot)` through `ensureElectronIpc()`.

- [ ] **Step 1: Write failing pure resolver tests**

Cover sorting agents by descending `updatedAt`, deduplicating bucketed agents by id, limiting agents to 3, preferring the latest matching `/agent/:id` recent URL, generating `/<workspace>/agent/:id` or `/agent/:id` fallback URLs, and limiting page sections to 3 and 5.

- [ ] **Step 2: Run resolver tests and verify RED**

Run: `bunx vitest run --silent='passed-only' src/features/Electron/titlebar/TrayMenu/resolveSnapshot.test.ts`

Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Implement the pure resolver**

Use immutable sorting and a `Map<string, SidebarAgentItem>` for deduplication. Map resolved tabs to `{ title: page.meta.title, url: page.tab.url }`; map agents to `{ id, title: agent.title || 'Untitled', url }`.

- [ ] **Step 4: Verify resolver GREEN**

Run the Task 3 resolver command. Expected: PASS.

- [ ] **Step 5: Write failing synchronization hook tests**

Render the hook with representative stores, assert one snapshot IPC call after resolved metadata settles, assert identical rerenders do not resend, and assert IPC rejection is logged without breaking NavigationBar rendering.

- [ ] **Step 6: Implement and mount `useTrayMenuSync`**

Add `desktopTrayService.updateNavigationSnapshot`, implemented as
`ensureElectronIpc().tray.updateNavigationSnapshot(snapshot)`. The hook reads resolved pages and
home agents, memoizes the pure snapshot, and calls the service from an effect. Mount it once in
`NavigationBar`; do not place IPC calls inside Zustand actions.

- [ ] **Step 7: Run synchronization tests and verify GREEN**

Run:

```bash
bunx vitest run --silent='passed-only' src/features/Electron/titlebar/TrayMenu/resolveSnapshot.test.ts src/features/Electron/titlebar/TrayMenu/useTrayMenuSync.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/Electron/titlebar/TrayMenu src/features/Electron/titlebar/NavigationBar.tsx src/services/electron/tray.ts
git commit -m "✨ feat(desktop): sync tray navigation data"
```

### Task 4: Connect More surfaces and complete verification

**Files:**

- Modify: `src/features/Electron/titlebar/NavigationBar.tsx`
- Modify: `src/features/Electron/titlebar/NavigationBar.test.tsx`

**Interfaces:**

- Consumes: `openRecentlyViewed` and `openAllAgents` broadcasts from Task 1.

- Calls: `setHistoryOpen(true)` and `useHomeStore.getState().openAllAgentsDrawer()`.

- [ ] **Step 1: Write failing broadcast tests**

Assert `openRecentlyViewed` opens the existing Popover. Assert `openAllAgents` navigates to the active scope root if necessary and calls `openAllAgentsDrawer`; neither event creates a topic.

- [ ] **Step 2: Run the NavigationBar test and verify RED**

Run: `bunx vitest run --silent='passed-only' src/features/Electron/titlebar/NavigationBar.test.tsx`

Expected: FAIL because the broadcasts are not watched.

- [ ] **Step 3: Implement broadcast watchers**

Use `useWatchBroadcast` in `NavigationBar`. Keep the existing Popover controlled by `historyOpen`; call the existing home store action for All Agents after showing the main route.

- [ ] **Step 4: Run all targeted tests and repository checks**

Run:

```bash
bun run check packages/electron-client-ipc/src/types/tray.ts packages/electron-client-ipc/src/events/navigation.ts apps/desktop/src/main/controllers/TrayMenuCtr.ts apps/desktop/src/main/core/ui/Tray.ts apps/desktop/src/main/core/ui/TrayManager.ts apps/desktop/src/main/menus src/features/Electron/titlebar/TrayMenu src/features/Electron/titlebar/NavigationBar.tsx
```

Expected: lint and related tests pass with exit code 0.

- [ ] **Step 5: Perform desktop runtime verification**

Start the desktop development app, then verify on macOS: left-click and right-click show identical menus; Quick Composer only starts from its menu item or shortcut; dynamic sections reflect current scope; Agent and page items navigate correctly; More surfaces open; empty sections disappear; Quit remains terminal.

- [ ] **Step 6: Commit**

```bash
git add src/features/Electron/titlebar/NavigationBar.tsx src/features/Electron/titlebar/NavigationBar.test.tsx
git commit -m "✅ test(desktop): verify tray navigation flows"
```
