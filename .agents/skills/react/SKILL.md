---
name: react
description: 'Use for TSX components, UI libraries, styling, state locality, layout, render performance and memoization.'
user-invocable: false
---

# React Component Writing Guide

## Styling

| Scenario                                                   | Approach                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files already on StyleX, and new SPA styles                | `stylex.create` + `@lobehub/ui/stylex/cssVar.stylex` / `@lobehub/ui/stylex/media.stylex`. The SPA compiler is `plugins/vite/stylex.ts` (`@stylexjs/unplugin`, prefix `lh`). Do not copy those token modules into the app. |
| Existing styles not yet migrated                           | `createStaticStyles` + `cssVar.*` (zero-runtime, module-level)                                                                                                                                                            |
| Simple one-off                                             | Inline `style` attribute                                                                                                                                                                                                  |
| Truly dynamic (JS color fns like `readableColor`/`chroma`) | `createStyles` + `token` — **last resort**                                                                                                                                                                                |

### StyleX

- New code may not import `createStaticStyles` / `createStyles` / `css` / `keyframes` / `createGlobalStyle` / `injectGlobal` from `@lobehub/ui` (`stylex-migration/no-emotion-styles`). Files still on them are listed in `scripts/stylexMigration/legacyFiles.json`; after migrating one, run `bun run stylex:migration --prune-legacy`. Never add entries.
- Migrate a whole file at once. StyleX longhand rules carry raised specificity (`.x:not(#\#)`) and beat emotion classes on the same element, but StyleX shorthand rules do not, so a half-migrated element resolves by property.
- Element that also forwards a caller's `className` / `style`: `{...sx([styles.root, active && styles.active], className, style)}` from `@/styles/sx`. Spreading `stylex.props` next to `className` fails `@stylexjs/no-conflicting-props`.
- Component that lets callers restyle it: take `xstyle?: StyleXStyles` and pass it last in the `sx` / `stylex.props` array. A plain `className` from outside cannot override StyleX rules. Passing a class to `@lobehub/ui` components (`className`, `classNames`) works, because lobe-ui CSS sits in `@layer lobe-ui`.
- Values follow `@stylexjs/valid-styles`: no multi-value shorthands (`margin: '0 8px'` → `marginBlock` / `marginInline`), and string `flex` (`flex: '1'`).
- `background`, `animation`, `border` and `border{Top,Right,Bottom,Left}` shorthands compile to no class at all, whatever the value (`border: 'none'` included), without an error. Write longhands: `backgroundColor` (plus `backgroundImage: 'none'` when replacing a `background` shorthand), `animationName` / `animationDuration` / …, `borderWidth` / `borderStyle` / `borderColor`.
- Check a migration in dev with the DevDock snapshot helper: on the migrated page run `__lobeStyleSnapshot.capture('<name>', '<root selector>')`, swap the files back (`git stash push -- <path>`), reload, run `__lobeStyleSnapshot.compare('<name>')`, then `git stash pop`. Each pair reads `[captured, current]`, here `[migrated, original]`. It lists elements and `::before` / `::after` whose tracked computed styles, box (relative to the root) or text differ; an empty list means those match, not that hover, focus or closed dialogs were checked, so open each state you migrated and compare it too. Keep the window size, scroll everything under the root back to the start, and move the pointer off the compared area.
- `bun run stylex:migration --list <A|B|C|D>` lists files by how hard they are to move: A flat, B self pseudo-classes, C descendant / ancestor coupling (use `stylex.defaultMarker()` + `stylex.when.ancestor()` or `xstyle`), D tag / third-party DOM selectors (scoped plain CSS).

## Component Priority

1. **`src/components`** — project-specific reusable components
2. **`@lobehub/ui/base-ui`** — headless primitives. **If the component lives here, use it. Do NOT import the same-named root export.**
3. **`@lobehub/ui`** — higher-level / antd-wrapping components (only when no base-ui equivalent)
4. **antd** — only when neither base-ui nor `@lobehub/ui` root provides it
5. **Custom implementation** — true last resort

If unsure about available components, search existing code or check `node_modules/@lobehub/ui/es/index.mjs` and `node_modules/@lobehub/ui/es/base-ui/`.

### `@lobehub/ui/base-ui` — always prefer for these

| Component                                  | Import                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `Alert` (+ `AlertProps`)                   | `import { Alert, type AlertProps } from '@lobehub/ui/base-ui';`                                         |
| `Select` (+ `SelectProps`, `SelectOption`) | `import { Select } from '@lobehub/ui/base-ui';`                                                         |
| `Modal` (imperative API)                   | `import { createModal, confirmModal, useModalContext, type ModalInstance } from '@lobehub/ui/base-ui';` |
| `DropdownMenu`                             | `import { DropdownMenu } from '@lobehub/ui/base-ui';`                                                   |
| `ContextMenu`                              | `import { ContextMenu } from '@lobehub/ui/base-ui';`                                                    |
| `Popover`                                  | `import { Popover } from '@lobehub/ui/base-ui';`                                                        |
| `ScrollArea`                               | `import { ScrollArea } from '@lobehub/ui/base-ui';`                                                     |
| `Switch`                                   | `import { Switch } from '@lobehub/ui/base-ui';`                                                         |
| `Toast`                                    | `import { Toast } from '@lobehub/ui/base-ui';`                                                          |
| `FloatingSheet`                            | `import { FloatingSheet } from '@lobehub/ui/base-ui';`                                                  |
| `Drawer`                                   | `import { Drawer } from '@lobehub/ui/base-ui';`                                                         |

For Modal specifically, see the dedicated **modal** skill — use the imperative `createModal({ content: … })` pattern over the legacy `<Modal open … />` declarative pattern. base-ui has its own `ModalHost` already mounted in `SPAGlobalProvider`.

> Common slip: `import { Select } from '@lobehub/ui'` looks fine but it's the antd-backed Select. Use base-ui Select. Same for `Modal`, `DropdownMenu`, etc.

### `@lobehub/ui` root — use when base-ui has no equivalent

| Category     | Components                                                                            |
| ------------ | ------------------------------------------------------------------------------------- |
| General      | ActionIcon, ActionIconGroup, Block, Button, Icon                                      |
| Data Display | Avatar, Collapse, Empty, Highlighter, Markdown, Tag, Tooltip                          |
| Data Entry   | CodeEditor, CopyButton, EditableText, Form, Input, InputPassword, SearchBar, TextArea |
| Layout       | Center, DraggablePanel, Flexbox, Grid, Header, MaskShadow                             |
| Navigation   | Burger, Menu, SideNav, Tabs                                                           |

## State

Keep transient state in its smallest useful owner. Extract a custom hook when state transitions and handlers obscure rendering or form a reusable unit; do not extract solely because a component has a particular number of hooks.

Split a component only to establish a real state, reuse, render-update, or mountable-capability boundary. Do not split solely to make files smaller; when a file reaches the 1200-line limit in **`source-layout`**, find one of these boundaries rather than cutting at a line count. Decomposing a heavy domain feature into host-assembled atoms is owned by **`compose-atoms`**.

## Popover Exits

An action inside popover content that leaves the popover must close it, or the popover stays over the destination (for example, a plan badge in the user panel navigating to `/settings/plans`).

- Navigation: a host whose content links or navigates keeps `open` state, calls `useCloseOnNavigate(open, () => setOpen(false))` from `@/hooks/useCloseOnNavigate`, and passes the returned key to its `Popover`. This covers links added later, including links from other files. The key matters when navigation hides the host in an `<Activity>` (the home sidebar): a hidden tree sets up no new effects, so the base-ui popup never finishes its exit animation and stays on screen until a remount removes it.
- Modal handoff or a final pick: call `usePopoverContext().close()` (or the host's setter) before opening the modal or after the pick, as `NavPanel/switcher/SwitcherMenu.tsx` does. Content rendered outside a popover cannot use the context, because its default `close` throws in development.
- A confirm step whose result appears in the same popover, such as the share-link privacy confirm, keeps it open.

## Render Performance and Memoization

Treat `memo`, `useMemo`, and `useCallback` as opt-in optimizations, not default component wrappers. Before adding one, identify the actual rerender boundary and prefer structural fixes:

1. Split at the update boundary.
2. Move transient state to its smallest owner.
3. Use narrow Zustand selectors and avoid broad subscriptions.

Do not memoize prop-free or trivially rendered components, or a component that normally receives new objects, arrays, functions, or JSX children. Do not use memoization to compensate for state held too high in the tree.

Use memoization only when the subtree is demonstrably expensive or frequently repeated, its relevant inputs are stable during normal parent renders, and profiling or a concrete render-path analysis identifies the avoided work. State that reason in the implementation summary or PR.

## Layout

Use `Flexbox` and `Center` from `@lobehub/ui`. See `references/layout-kit.md` for full props and examples.

- Use `gap` instead of `margin` for spacing between flex children
- Use `flex={1}` to fill available space
- Nest Flexbox for complex layouts; set `overflow: 'auto'` for scrollable regions

## Related Skills

- **`ux`**: loading visuals (scenario → loader table in `references/feedback.md` §4.1) and user-facing interaction design.
- **`modal`**: imperative base-ui modal patterns.
- **`spa-routes`**: SPA navigation, route ownership, router configuration, and `.desktop` variants.
- **`compose-atoms`**: split a heavy domain feature into mountable capability atoms; each host imports only what it mounts.
- **`zustand`**: store structure and selector conventions.
