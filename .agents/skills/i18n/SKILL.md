---
name: i18n
description: "LobeHub internationalization with react-i18next. Use when adding any user-facing string in `.tsx`/`.ts` files, creating or renaming a key under `src/locales/default/{namespace}.ts`, deciding the `{feature}.{context}.{action}` flat-key pattern, wiring a new namespace into `src/locales/default/index.ts`, or translating zh-CN/en-US JSON for dev preview. Triggers on `useTranslation`, `t('foo.bar')`, `i18next.t`, `{{variable}}` interpolation, hardcoded UI strings (zh or en) that should be extracted, 'add i18n', '加 i18n key', '翻译', 'locale key', 'namespace', 'pnpm i18n'."
user-invocable: false
---

# LobeHub Internationalization Guide

- Default language: English (en-US)
- Framework: react-i18next
- **Only edit files in `src/locales/default/`** - Never edit JSON files in `locales/`
- Run `pnpm i18n` to generate translations (or manually translate zh-CN/en-US for dev preview)

## Key Naming Convention

**Flat keys with dot notation** (not nested objects):

```typescript
// ✅ Correct
export default {
  'alert.cloud.action': '立即体验',
  'sync.actions.sync': '立即同步',
  'sync.status.ready': '已连接',
};

// ❌ Avoid nested objects
export default {
  alert: { cloud: { action: '...' } },
};
```

**Patterns:** `{feature}.{context}.{action|status}`

**Parameters:** Use `{{variableName}}` syntax

```typescript
'alert.cloud.desc': '我们提供 {{credit}} 额度积分',
```

**Avoid key conflicts:**

```typescript
// ❌ Conflict
'clientDB.solve': '自助解决',
'clientDB.solve.backup.title': '数据备份',

// ✅ Solution
'clientDB.solve.action': '自助解决',
'clientDB.solve.backup.title': '数据备份',
```

## Workflow

1. Add keys to `src/locales/default/{namespace}.ts`
2. Export new namespace in `src/locales/default/index.ts`
3. For dev preview: manually translate `locales/zh-CN/{namespace}.json` and `locales/en-US/{namespace}.json`
4. Remind the user to run `pnpm i18n` before creating PR — do NOT run it yourself (very slow)

## Usage

```tsx
import { useTranslation } from 'react-i18next';

const { t } = useTranslation('common');

t('newFeature.title');
t('alert.cloud.desc', { credit: '1000' });

// Multiple namespaces
const { t } = useTranslation(['common', 'chat']);
t('common:save');
```

## Common Namespaces

**Most used:** `common` (shared UI), `chat` (chat features), `setting` (settings)

Others: auth, changelog, components, discover, editor, electron, error, file, hotkey, knowledgeBase, memory, models, plugin, portal, providers, tool, topic
