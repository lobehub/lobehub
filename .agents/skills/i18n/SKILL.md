---
name: i18n
description: Internationalization guide using react-i18next. Use when adding translations, creating i18n keys, or working with localized text in React components (.tsx files). Triggers on translation tasks, locale management, or i18n implementation.
---

# LobeChat Internationalization Guide

- Default language: Chinese (zh-CN)
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
4. Run `pnpm i18n` to generate all languages (CI handles this automatically)

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
