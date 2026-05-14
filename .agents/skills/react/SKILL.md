---
name: react
description: 'Use when writing or editing any `.tsx` under `src/**`. Triggers: createStaticStyles, createStyles, cssVar, antd-style, Flexbox, Center, Select, Modal, Drawer, Button, Tooltip, DropdownMenu, Popover, Switch, ScrollArea, Link, useNavigate, react-router-dom, next/link, desktopRouter, componentMap.desktop, .desktop.tsx, new component, new page, edit layout, add styles, zustand selector, @lobehub/ui, antd import.'
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
2. **`@lobehub/ui/base-ui`** — headless primitives (Select, Modal, DropdownMenu, Popover, Switch, ScrollArea…)
3. **`@lobehub/ui`** — higher-level components (ActionIcon, Markdown, DragPage…)
4. **Custom implementation** — last resort; never reach for antd directly

If unsure about available components, search existing code or check `node_modules/@lobehub/ui/es/index.mjs`.

### Common @lobehub/ui Components

| Category     | Components                                                                      |
| ------------ | ------------------------------------------------------------------------------- |
| General      | ActionIcon, ActionIconGroup, Block, Button, Icon                                |
| Data Display | Avatar, Collapse, Empty, Highlighter, Markdown, Tag, Tooltip                    |
| Data Entry   | CodeEditor, CopyButton, EditableText, Form, FormModal, Input, SearchBar, Select |
| Feedback     | Alert, Drawer, Modal                                                            |
| Layout       | Center, DraggablePanel, Flexbox, Grid, Header, MaskShadow                       |
| Navigation   | Burger, Dropdown, Menu, SideNav, Tabs                                           |

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

| Mistake                                  | Fix                                                    |
| ---------------------------------------- | ------------------------------------------------------ |
| Using `next/link` in SPA                 | Use `react-router-dom` `Link`                          |
| Using antd directly                      | Use `@lobehub/ui/base-ui` first, then `@lobehub/ui`    |
| `createStyles` for static styles         | Use `createStaticStyles` + `cssVar`                    |
| Editing only `desktopRouter.config.tsx`  | Must edit both `.tsx` and `.desktop.tsx`               |
| Using `margin` for flex spacing          | Use `gap` prop on Flexbox                              |
| Accessing zustand store without selector | Use selectors to access store data (see zustand skill) |
