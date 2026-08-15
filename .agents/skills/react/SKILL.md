---
name: react
description: 'LobeHub React component conventions. Use when editing TSX UI, choosing base-ui vs @lobehub/ui vs antd, styling with antd-style, component boundaries, local state, layouts, render performance, or memoization.'
user-invocable: false
---

# React Component Writing Guide

## Styling

| Scenario                                                   | Approach                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| Most cases                                                 | `createStaticStyles` + `cssVar.*` (zero-runtime, module-level) |
| Simple one-off                                             | Inline `style` attribute                                       |
| Truly dynamic (JS color fns like `readableColor`/`chroma`) | `createStyles` + `token` — **last resort**                     |

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

Split a component only to establish a real state, reuse, or render-update boundary. Do not split solely to make files smaller.

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

- **`ux`**: loading visuals and user-facing interaction design. Do not use antd `Spin` / `<Spin />`.
- **`modal`**: imperative base-ui modal patterns.
- **`spa-routes`**: SPA navigation, route ownership, router configuration, and `.desktop` variants.
- **`zustand`**: store structure and selector conventions.
