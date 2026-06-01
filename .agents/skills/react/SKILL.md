---
name: react
description: 'LobeHub React component conventions. Use when editing TSX UI, choosing base-ui vs @lobehub/ui vs antd, styling with antd-style, routing, desktop variants, layouts, or component state.'
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
| `Select` (+ `SelectProps`, `SelectOption`) | `import { Select } from '@lobehub/ui/base-ui';`                                                         |
| `Modal` (imperative API)                   | `import { createModal, confirmModal, useModalContext, type ModalInstance } from '@lobehub/ui/base-ui';` |
| `DropdownMenu`                             | `import { DropdownMenu } from '@lobehub/ui/base-ui';`                                                   |
| `ContextMenu`                              | `import { ContextMenu } from '@lobehub/ui/base-ui';`                                                    |
| `Popover`                                  | `import { Popover } from '@lobehub/ui/base-ui';`                                                        |
| `ScrollArea`                               | `import { ScrollArea } from '@lobehub/ui/base-ui';`                                                     |
| `Switch`                                   | `import { Switch } from '@lobehub/ui/base-ui';`                                                         |
| `Toast`                                    | `import { Toast } from '@lobehub/ui/base-ui';`                                                          |
| `FloatingSheet`                            | `import { FloatingSheet } from '@lobehub/ui/base-ui';`                                                  |

For Modal specifically, see the dedicated **modal** skill — use the imperative `createModal({ content: … })` pattern over the legacy `<Modal open … />` declarative pattern. base-ui has its own `ModalHost` already mounted in `SPAGlobalProvider`.

> Common slip: `import { Select } from '@lobehub/ui'` looks fine but it's the antd-backed Select. Use base-ui Select. Same for `Modal`, `DropdownMenu`, etc.

### `@lobehub/ui` root — use when base-ui has no equivalent

| Category     | Components                                                                            |
| ------------ | ------------------------------------------------------------------------------------- |
| General      | ActionIcon, ActionIconGroup, Block, Button, Icon                                      |
| Data Display | Avatar, Collapse, Empty, Highlighter, Markdown, Tag, Tooltip                          |
| Data Entry   | CodeEditor, CopyButton, EditableText, Form, Input, InputPassword, SearchBar, TextArea |
| Feedback     | Alert, Drawer                                                                         |
| Layout       | Center, DraggablePanel, Flexbox, Grid, Header, MaskShadow                             |
| Navigation   | Burger, Menu, SideNav, Tabs                                                           |

## Layout

Use `Flexbox` and `Center` from `@lobehub/ui`. See `references/layout-kit.md` for full props and examples.

- Use `gap` instead of `margin` for spacing between flex children
- Use `flex={1}` to fill available space
- Nest Flexbox for complex layouts; set `overflow: 'auto'` for scrollable regions

## Navigation

**For SPA pages, use `react-router-dom`, NOT `next/link`.**

```tsx
// ❌ Wrong
import Link from 'next/link';

// ✅ Correct
import { Link, useNavigate } from 'react-router-dom';
```

Access navigate from stores: `useGlobalStore.getState().navigate?.('/settings');`

## Desktop File Sync Rule

Files with a `.desktop.ts(x)` variant must be edited **in sync**. Drift causes blank pages in Electron.

| Base file (web)            | Desktop file (Electron)            |
| -------------------------- | ---------------------------------- |
| `desktopRouter.config.tsx` | `desktopRouter.config.desktop.tsx` |
| `componentMap.ts`          | `componentMap.desktop.ts`          |

**After editing any `.ts`/`.tsx`:** glob for `<filename>.desktop.{ts,tsx}` in the same directory. If found, apply the equivalent sync-import change.

## Routing Architecture

| Route Type         | Use Case   | Implementation                                     |
| ------------------ | ---------- | -------------------------------------------------- |
| Next.js App Router | Auth pages | `src/app/[variants]/(auth)/`                       |
| React Router DOM   | Main SPA   | `desktopRouter.config.tsx` + `.desktop.tsx` (pair) |

Router utilities:

```tsx
import { dynamicElement, redirectElement, ErrorBoundary } from '@/utils/router';
element: dynamicElement(() => import('./chat'), 'Desktop > Chat');
element: redirectElement('/settings/profile');
errorElement: <ErrorBoundary />;
```

## Common Mistakes

| Mistake                                                            | Fix                                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Using `next/link` in SPA                                           | Use `react-router-dom` `Link`                                               |
| Using antd directly                                                | Use `@lobehub/ui/base-ui` first, then `@lobehub/ui`                         |
| `import { Select } from '@lobehub/ui'`                             | `import { Select } from '@lobehub/ui/base-ui'`                              |
| `import { Modal } from '@lobehub/ui'` + `<Modal open>` declarative | `createModal` / `confirmModal` from `@lobehub/ui/base-ui` (see modal skill) |
| `import { DropdownMenu/Popover/Switch } from '@lobehub/ui'`        | Import same name from `@lobehub/ui/base-ui` instead                         |
| `createStyles` for static styles                                   | Use `createStaticStyles` + `cssVar`                                         |
| Editing only `desktopRouter.config.tsx`                            | Must edit both `.tsx` and `.desktop.tsx`                                    |
| Using `margin` for flex spacing                                    | Use `gap` prop on Flexbox                                                   |
| Accessing zustand store without selector                           | Use selectors to access store data (see zustand skill)                      |
| Text or icon-text actions built with `Flexbox`/`Text` + `onClick`  | Use `Button type={'text'} size={'small'}` with `icon` when needed           |
