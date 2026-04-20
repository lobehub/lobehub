---
name: react
description: React component development guide. Use when working with React components (.tsx files), creating UI, using @lobehub/ui components, implementing routing, or building frontend features. Triggers on React component creation, modification, layout implementation, or navigation tasks.
---

# React Component Writing Guide

- Use antd-style for complex styles; for simple cases, use inline `style` attribute
  - **Prefer `createStaticStyles` with `cssVar.*`** (zero-runtime) — module-level, no hook call required
  - Only fall back to `createStyles` + `token` when styles genuinely need runtime computation (dynamic props, JS color fns like `readableColor`/`chroma`)
  - See `.cursor/docs/createStaticStyles_migration_guide.md` for full pattern
- Use `Flexbox` and `Center` from `@lobehub/ui` for layouts (see `references/layout-kit.md`)
- Component priority: `src/components` > `@lobehub/ui/base-ui` > `@lobehub/ui` > custom implementation
  - Always prefer `@lobehub/ui/base-ui` primitives (Select, Modal, DropdownMenu, Popover, Switch, ScrollArea…) over antd equivalents
  - Fall back to `@lobehub/ui` higher-level components when base-ui has no match
  - Only implement a custom component as a last resort — never reach for antd directly
- Use selectors to access zustand store data

## @lobehub/ui Components

If unsure about component usage, search existing code in this project. Most components extend antd with additional props.

Reference: `node_modules/@lobehub/ui/es/index.mjs` for all available components.

**Common Components:**

- General: ActionIcon, ActionIconGroup, Block, Button, Icon
- Data Display: Avatar, Collapse, Empty, Highlighter, Markdown, Tag, Tooltip
- Data Entry: CodeEditor, CopyButton, EditableText, Form, FormModal, Input, SearchBar, Select
- Feedback: Alert, Drawer, Modal
- Layout: Center, DraggablePanel, Flexbox, Grid, Header, MaskShadow
- Navigation: Burger, Dropdown, Menu, SideNav, Tabs

## Routing Architecture

Hybrid routing: Next.js App Router (static pages) + React Router DOM (main SPA).

| Route Type         | Use Case                          | Implementation                                                               |
| ------------------ | --------------------------------- | ---------------------------------------------------------------------------- |
| Next.js App Router | Auth pages (login, signup, oauth) | `src/app/[variants]/(auth)/`                                                 |
| React Router DOM   | Main SPA (chat, settings)         | `desktopRouter.config.tsx` + `desktopRouter.config.desktop.tsx` (must match) |

### Key Files

- Entry: `src/spa/entry.web.tsx` (web), `src/spa/entry.mobile.tsx`, `src/spa/entry.desktop.tsx`
- Desktop router (pair — **always edit both** when changing routes): `src/spa/router/desktopRouter.config.tsx` (dynamic imports) and `src/spa/router/desktopRouter.config.desktop.tsx` (sync imports). Drift can cause unregistered routes / blank screen.
- Mobile router: `src/spa/router/mobileRouter.config.tsx`
- Router utilities: `src/utils/router.tsx`

### `.desktop.{ts,tsx}` File Sync Rule

**CRITICAL**: Some files have a `.desktop.ts(x)` variant that Electron uses instead of the base file. When editing a base file, **always check** if a `.desktop` counterpart exists and update it in sync. Drift causes blank pages or missing features in Electron.

Known pairs that must stay in sync:

| Base file (web, dynamic imports)                      | Desktop file (Electron, sync imports)                         |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| `src/spa/router/desktopRouter.config.tsx`             | `src/spa/router/desktopRouter.config.desktop.tsx`             |
| `src/routes/(main)/settings/features/componentMap.ts` | `src/routes/(main)/settings/features/componentMap.desktop.ts` |

**How to check**: After editing any `.ts` / `.tsx` file, run `Glob` for `<filename>.desktop.{ts,tsx}` in the same directory. If a match exists, update it with the equivalent sync-import change.

### Router Utilities

```tsx
import { dynamicElement, redirectElement, ErrorBoundary } from '@/utils/router';

element: dynamicElement(() => import('./chat'), 'Desktop > Chat');
element: redirectElement('/settings/profile');
errorElement: <ErrorBoundary />;
```

### Navigation

**Important**: For SPA pages, use `Link` from `react-router-dom`, NOT `next/link`.

```tsx
// ❌ Wrong
import Link from 'next/link';
<Link href="/">Home</Link>;

// ✅ Correct
import { Link } from 'react-router-dom';
<Link to="/">Home</Link>;

// In components
import { useNavigate } from 'react-router-dom';
const navigate = useNavigate();
navigate('/chat');

// From stores
const navigate = useGlobalStore.getState().navigate;
navigate?.('/settings');
```
