---
name: modal
description: "LobeHub imperative-modal conventions. Use whenever creating, editing, opening, or migrating a modal/dialog/popup — prefer `createModal` / `confirmModal` / `useModalContext` from `@lobehub/ui/base-ui` (headless) over the legacy root `@lobehub/ui` `createModal` (antd Modal props) and over any declarative `open` state + `<Modal />` pattern. Covers required `ModalHost` mounting, the `Content` + `index.tsx` file layout, `content` vs `children` slot, i18n inside `createModal()` (`import { t } from 'i18next'`), and migration notes. Triggers on `createModal`, `confirmModal`, `useModalContext`, `ModalHost`, `antd Modal`, `<Modal open>`, 'open a modal', 'popup', 'dialog', 'confirm dialog', '弹框', '弹窗', '确认框', 'migrate to base-ui'."
user-invocable: false
---

# Modal Imperative API Guide

## Recommended: `@lobehub/ui/base-ui`

New code should use the **base-ui** modal stack (headless primitives, not antd `Modal`):

- `createModal`, `confirmModal`, `ModalHost` from `@lobehub/ui/base-ui`
- `useModalContext` from `@lobehub/ui/base-ui` inside modal **content**

Body slot: pass **`content`** (or `children`; runtime uses `content ?? children`).

### Global `ModalHost` (required)

Base-ui `createModal` renders through a **separate** host from the root package. The app must mount **`ModalHost`** from `@lobehub/ui/base-ui` once near the root (e.g. next to other global hosts). Without it, `createModal` calls will not appear.

If the project only mounts `ModalHost` from `@lobehub/ui`, add a second lazy `ModalHost` from `@lobehub/ui/base-ui` until all imperative modals are migrated.

### Why imperative?

| Mode        | Characteristics                      | Recommended |
| ----------- | ------------------------------------ | ----------- |
| Declarative | `open` state + `<Modal />`           | ❌          |
| Imperative  | Call `createModal()`, no local state | ✅          |

### File structure

```
features/
└── MyFeatureModal/
    ├── index.tsx            # export createXxxModal
    └── MyFeatureContent.tsx # modal body
```

### 1. Content (`MyFeatureContent.tsx`)

```tsx
'use client';

import { useModalContext } from '@lobehub/ui/base-ui';
import { useTranslation } from 'react-i18next';

export const MyFeatureContent = () => {
  const { t } = useTranslation('namespace');
  const { close } = useModalContext();

  return <div>{/* ... */}</div>;
};
```

### 2. `createModal` (`index.tsx`)

```tsx
'use client';

import { createModal } from '@lobehub/ui/base-ui';
import { t } from 'i18next';

import { MyFeatureContent } from './MyFeatureContent';

export const createMyFeatureModal = () =>
  createModal({
    content: <MyFeatureContent />,
    footer: null,
    maskClosable: true,
    styles: {
      content: { overflow: 'hidden', padding: 0 },
    },
    title: t('myFeature.title', { ns: 'setting' }),
    width: 'min(80%, 800px)',
  });
```

### 3. Usage

```tsx
import { createMyFeatureModal } from '@/features/MyFeatureModal';

const handleOpen = useCallback(() => {
  createMyFeatureModal();
}, []);

return <Button onClick={handleOpen}>Open</Button>;
```

### i18n

- **Content**: `useTranslation` in components.
- **`createModal` options**: `import { t } from 'i18next'` where hooks are unavailable.

### `useModalContext`

```tsx
const { close, setCanDismissByClickOutside } = useModalContext();
```

### Common options (base-ui)

`ImperativeModalProps` builds on `BaseModalProps`: `title`, `width`, `maskClosable`, `open`, `onOpenChange`, `footer`, `styles` / `classNames` (keys: `backdrop`, `popup`, `header`, `title`, `close`, `content`, …).

| Property       | Notes                                    |
| -------------- | ---------------------------------------- |
| `content`      | Main body (preferred name vs `children`) |
| `maskClosable` | Click outside to dismiss                 |
| `styles.*`     | Semantic regions, not antd `styles.body` |

### Confirm

```tsx
import { confirmModal } from '@lobehub/ui/base-ui';

confirmModal({
  title: '…',
  content: '…',
  okText: '…',
  cancelText: '…',
  onOk: async () => {},
});
```

---

## Legacy: `@lobehub/ui` (root)

Older call sites use **`createModal` from `@lobehub/ui`**, which is typed as **antd `Modal` props** (`children`, `allowFullscreen`, `getContainer`, `destroyOnHidden`, `styles.body`, etc.). Prefer migrating new work to **`@lobehub/ui/base-ui`**.

Examples (legacy): `src/features/SkillStore/index.tsx`, `src/features/LibraryModal/CreateNew/index.tsx`.

---

## Examples

- Base-ui (preferred): follow sections above; ensure **base-ui `ModalHost`** is mounted.
- Legacy: `src/features/SkillStore/index.tsx`, `src/features/LibraryModal/CreateNew/index.tsx`
