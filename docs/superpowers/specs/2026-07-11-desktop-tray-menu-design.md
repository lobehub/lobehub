# Desktop Tray Menu Redesign

## Objective

Replace the tray icon's implicit screenshot action with a predictable native menu on both
left-click and right-click. Reuse the desktop application's existing Pinned and Recent page
history so the menu provides useful navigation alongside explicit application actions.

## Interaction Contract

- Left-click and right-click open the same native tray menu.
- On Windows, tray double-click continues to open the main window. Windows single-click is
  deferred briefly so a double-click cancels the pending menu popup. macOS and Linux do not
  register a separate double-click action.
- Quick Composer remains an explicit menu item and keeps its existing configurable global
  shortcut. The tray icon itself does not start screen capture.
- Pinned and Recent entries navigate the main window to their stored URL. Recent contains only
  concrete topics and pages; generic destinations such as Home, Settings, list roots, Tasks, and
  Memory are excluded.
- Recent Agents shows at most three recently used agents. Selecting one restores that agent's
  most recent working route; it does not create a new topic.
- The initial menu shows at most three Pinned entries and five Recent entries.
- A More item opens the existing in-app Recently Viewed surface when additional entries exist;
  More Agents opens the in-app agent list.
- Static actions remain available: Quick Composer, Quick Chat, New Chat, Open LobeHub, Settings,
  and Quit.
- Empty Pinned, Recent Agents, or Recent sections are omitted instead of rendering disabled
  empty-state rows.

The complete menu is divided into five semantic layers:

1. Pinned: two or three explicitly pinned pages or tasks.
2. Recent Agents: up to three agents ordered by recent use, followed by More Agents when needed.
3. Recent: three to five concrete topics or pages, followed by More when needed. Each item uses
   two lines: title first, then Agent name for a topic or `Page` for a page.
4. Quick Actions: Quick Composer, Quick Chat, and New Chat.
5. Application: Open LobeHub, Settings, and Quit, with Quit separated as the terminal action.

## Architecture

### Renderer ownership

The renderer remains the source of truth for recently viewed pages. It already owns route
matching, workspace scope, dynamic titles, and Pinned/Recent ordering. A small synchronizer
derives a serializable tray snapshot from the resolved page list and sends it to the main
process whenever the active scope or resolved entries change.

The snapshot contains only display and navigation data:

```ts
interface TrayNavigationItem {
  subtitle?: string;
  title: string;
  url: string;
}

interface TrayAgentItem {
  id: string;
  title: string;
  url: string;
}

interface TrayNavigationSnapshot {
  agents: TrayAgentItem[];
  pinned: TrayNavigationItem[];
  recent: TrayNavigationItem[];
}
```

The main process must not reconstruct titles from SPA routes or query application databases.

Recent Agents is derived in the renderer from the existing workspace-scoped sidebar agent data,
which is already ordered by `agents.updatedAt`. The renderer associates each agent with its most
recent matching navigation entry when available; otherwise it uses the agent's canonical route.
This preserves workspace visibility and route ownership without adding a tray-specific server
query. Agent usage ranking by topic count is intentionally not used because it represents
frequency rather than recency.

### IPC boundary

Add a typed tray IPC method that accepts the latest navigation snapshot. The tray controller
validates and stores the snapshot through the tray manager. Updating the snapshot rebuilds the
native menu so the next click presents current data.

If synchronization has not occurred, the tray still renders the static action section. A
renderer failure therefore degrades to the existing functional menu rather than blocking tray
access.

### Main-process menu ownership

Move tray menu composition behind one shared builder instead of duplicating dynamic logic in
macOS, Windows, and Linux templates. Platform menu implementations may retain platform-specific
labels, but all platforms consume the same navigation snapshot and action callbacks.

The native Electron menu uses disabled section labels for Pinned, Recent Agents, and Recent;
normal actionable items for agents and pages; separators between semantic layers; and navigation
commands for More and More Agents. Recent items use Electron's native `sublabel` for the second
line. Empty dynamic sections are omitted.

## Navigation Flow

Selecting a Pinned, Recent Agent, or Recent item:

1. Shows the existing main browser window.
2. Broadcasts the existing typed `navigate` event with the stored URL and `escape: true`.
3. Leaves workspace-aware URL ownership in the renderer; the main process treats the URL as an
   opaque internal route.

The More command shows the main window and opens the existing Recently Viewed popover through a
new typed broadcast. It does not reproduce the full list inside a nested native menu.

More Agents shows the main window and navigates to the existing agent browsing surface. New Chat
is the only tray action in this design that creates a new conversation, keeping restoration and
creation semantics distinct.

## Testing

Behavior-oriented tests cover:

- left-click and right-click both opening the stored menu;
- click and double-click never starting Quick Composer or unexpectedly showing the main window;
- snapshot updates rebuilding the menu;
- dynamic section omission and Pinned, Recent Agents, and Recent item limits;
- Recent Agent selection restoring its route without creating a topic;
- navigation items showing the main window and broadcasting their URL;
- static actions, including New Chat, remaining available without renderer data;
- renderer synchronization emitting resolved page and agent titles and URLs.
- Recent filtering excluding generic routes and providing Agent/Page sublabels.

Tests must avoid snapshots of the entire menu template. Assertions target visible labels,
callbacks, limits, and navigation outcomes.

## Scope Exclusions

- Usage/quota information from the OpenAI reference is not included.
- Session database pinning is not merged with desktop page pinning.
- No new screenshot workflow or shortcut is introduced.
- No custom tray window is built; the implementation remains a native Electron menu.
