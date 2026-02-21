---
name: modal
description: Modal imperative API guide. Use when creating modal dialogs using createModal from @lobehub/ui. Triggers on modal component implementation or dialog creation tasks.
user-invocable: false
---

# Modal Imperative API Guide

Use `createModal` from `@lobehub/ui` for imperative modal dialogs.

## Why Imperative?

| Mode        | Characteristics                       | Recommended |
| ----------- | ------------------------------------- | ----------- |
| Declarative | Need `open` state, render `<Modal />` | ❌          |
| Imperative  | Call function directly, no state      | ✅          |

## File Structure

```
features/
└── MyFeatureModal/
    ├── index.tsx           # Export createXxxModal
    └── MyFeatureContent.tsx # Modal content
```

## Implementation

### 1. Content Component (`MyFeatureContent.tsx`)

```tsx
'use client';

import { useModalContext } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

export const MyFeatureContent = () => {
  const { t } = useTranslation('namespace');
  const { close } = useModalContext(); // Optional: get close method

  return <div>{/* Modal content */}</div>;
};
```

### 2. Export createModal (`index.tsx`)

```tsx
'use client';

import { createModal } from '@lobehub/ui';
import { t } from 'i18next'; // Note: use i18next, not react-i18next

import { MyFeatureContent } from './MyFeatureContent';

export const createMyFeatureModal = () =>
  createModal({
    allowFullscreen: true,
    children: <MyFeatureContent />,
    destroyOnHidden: false,
    footer: null,
    styles: { body: { overflow: 'hidden', padding: 0 } },
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

## i18n Handling

- **Content component**: `useTranslation` hook (React context)
- **createModal params**: `import { t } from 'i18next'` (non-hook, imperative)

## useModalContext Hook

```tsx
const { close, setCanDismissByClickOutside } = useModalContext();
```

## Common Config

| Property          | Type                | Description              |
| ----------------- | ------------------- | ------------------------ |
| `allowFullscreen` | `boolean`           | Allow fullscreen mode    |
| `destroyOnHidden` | `boolean`           | Destroy content on close |
| `footer`          | `ReactNode \| null` | Footer content           |
| `width`           | `string \| number`  | Modal width              |

## Examples

- `src/features/SkillStore/index.tsx`
- `src/features/LibraryModal/CreateNew/index.tsx`
