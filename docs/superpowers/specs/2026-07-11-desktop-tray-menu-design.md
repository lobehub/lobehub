# Desktop Tray Menu Redesign

## Objective

Replace the tray icon's implicit screenshot action with a predictable native menu on both
left-click and right-click. Reuse the desktop application's existing Pinned and Recent page
history so the menu provides useful navigation alongside explicit application actions.

## Interaction Contract

- Left-click and right-click open the same native tray menu.
- Tray double-click no longer opens the main window because it conflicts with the unified
  click behavior.
- Quick Composer remains an explicit menu item and keeps its existing configurable global
  shortcut. The tray icon itself does not start screen capture.
- Pinned and Recent entries navigate the main window to their stored URL.
- The initial menu shows at most three Pinned entries and five Recent entries.
- A More item opens the existing in-app Recently Viewed surface when additional entries exist.
- Static actions remain available: Quick Composer, Quick Chat, Open LobeHub, Settings, and Quit.
- Empty Pinned or Recent sections are omitted instead of rendering disabled empty-state rows.

## Architecture

### Renderer ownership

The renderer remains the source of truth for recently viewed pages. It already owns route
matching, workspace scope, dynamic titles, and Pinned/Recent ordering. A small synchronizer
derives a serializable tray snapshot from the resolved page list and sends it to the main
process whenever the active scope or resolved entries change.

The snapshot contains only display and navigation data:

```ts
interface TrayNavigationItem {
  title: string;
  url: string;
}

interface TrayNavigationSnapshot {
  pinned: TrayNavigationItem[];
  recent: TrayNavigationItem[];
}
```

The main process must not reconstruct titles from SPA routes or query application databases.

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

The native Electron menu uses disabled section labels for Pinned and Recent, normal actionable
items for pages, separators between sections, and a submenu or navigation command for More.

## Navigation Flow

Selecting a Pinned or Recent item:

1. Shows the existing main browser window.
2. Broadcasts the existing typed `navigate` event with the stored URL and `escape: true`.
3. Leaves workspace-aware URL ownership in the renderer; the main process treats the URL as an
   opaque internal route.

The More command shows the main window and opens the existing Recently Viewed popover through a
new typed broadcast. It does not reproduce the full list inside a nested native menu.

## Testing

Behavior-oriented tests cover:

- left-click and right-click both opening the stored menu;
- click and double-click never starting Quick Composer or unexpectedly showing the main window;
- snapshot updates rebuilding the menu;
- section omission and item limits;
- navigation items showing the main window and broadcasting their URL;
- static actions remaining available without renderer data;
- renderer synchronization emitting resolved titles and URLs.

Tests must avoid snapshots of the entire menu template. Assertions target visible labels,
callbacks, limits, and navigation outcomes.

## Scope Exclusions

- Usage/quota information from the OpenAI reference is not included.
- Session database pinning is not merged with desktop page pinning.
- No new screenshot workflow or shortcut is introduced.
- No custom tray window is built; the implementation remains a native Electron menu.
