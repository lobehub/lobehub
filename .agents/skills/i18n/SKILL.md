---
name: i18n
description: 'LobeHub i18n with react-i18next. Use for user-facing strings, locale keys, namespaces, useTranslation, t(), interpolation, zh-CN/en-US previews, hardcoded UI copy, or pnpm i18n.'
user-invocable: false
---

# LobeHub Internationalization Guide

- Default language: English (en-US)
- Framework: react-i18next
- Add or update the English source copy in `src/locales/default/{namespace}.ts`
- Mirror the same keys by hand to `locales/en-US/{namespace}.json`
- Hand-translate the same keys to `locales/zh-CN/{namespace}.json`
- Leave all other locale files to the daily `auto-i18n.yml` workflow
- Do **not** run `pnpm i18n` by default. Run it only when the branch needs translated locales immediately; it is slow, requires `OPENAI_API_KEY`, and value-only edits do not need it.

## Key Naming Convention

**Flat keys with dot notation** (not nested objects):

```typescript
// ✅ Correct
export default {
  'alert.cloud.action': 'Try now',
  'sync.actions.sync': 'Sync now',
  'sync.status.ready': 'Connected',
};

// ❌ Avoid nested objects
export default {
  alert: { cloud: { action: '...' } },
};
```

**Patterns:** `{feature}.{context}.{action|status}`

**Parameters:** Use `{{variableName}}` syntax

```typescript
'alert.cloud.desc': 'We provide {{credit}} credits',
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

1. Add keys or value edits to `src/locales/default/{namespace}.ts` using English source text.
2. Export a new namespace in `src/locales/default/index.ts` if the namespace did not exist.
3. Mirror the same keys and English values to `locales/en-US/{namespace}.json`.
4. Add the Chinese translation to `locales/zh-CN/{namespace}.json`.
5. Do not edit other `locales/*` files manually; CI will fill missing languages.
6. Do not run `pnpm i18n` unless this branch must ship generated translations immediately.

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
