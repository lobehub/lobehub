---
name: react
description: React component development guide. Use when working with React components (.tsx files), creating UI, using @lobehub/ui components, implementing routing, or building frontend features. Triggers on React component creation, modification, layout implementation, or navigation tasks.
---

# React Component Writing Guide

- Use antd-style for complex styles; for simple cases, use inline `style` attribute
- Use `Flexbox` and `Center` from `@lobehub/ui` for layouts (see `references/layout-kit.md`)
- Component priority: `src/components` > installed packages > `@lobehub/ui` > antd
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

| Route Type         | Use Case                          | Implementation               |
| ------------------ | --------------------------------- | ---------------------------- |
| Next.js App Router | Auth pages (login, signup, oauth) | `src/app/[variants]/(auth)/` |
| React Router DOM   | Main SPA (chat, settings)         | `desktopRouter.config.tsx`   |

### Key Files

- Entry: `src/app/[variants]/page.tsx`
- Desktop router: `src/app/[variants]/router/desktopRouter.config.tsx`
- Mobile router: `src/app/[variants]/(mobile)/router/mobileRouter.config.tsx`
- Router utilities: `src/utils/router.tsx`

### Router Utilities

```tsx
import { dynamicElement, redirectElement, ErrorBoundary } from '@/utils/router';

element: dynamicElement(() => import('./chat'), 'Desktop > Chat');
element: redirectElement('/settings/profile');
errorElement: <ErrorBoundary resetPath="/chat" />;
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
