---
name: i18n
description: 'Use for user-facing strings and react-i18next locale keys, namespaces, interpolation, translations or bun run i18n.'
user-invocable: false
---

# LobeHub Internationalization Guide

- Default language: English (en-US)
- Framework: react-i18next
- **Only edit files in `packages/locales/src/default/`** - Never hand-write translations in `locales/` JSON (except en-US/zh-CN previews); generated locales change only through `lobe-i18n`, plus the key deletions described in [Changing an existing key's English text](#changing-an-existing-keys-english-text)
- Generate the other locales on demand with `bun run i18n` and `OPENAI_API_KEY`

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

1. Add keys to `packages/locales/src/default/{namespace}.ts`
2. Export new namespace in `packages/locales/src/default/index.ts`
3. For dev preview: manually translate `locales/zh-CN/{namespace}.json` and `locales/en-US/{namespace}.json`
4. Run `bun run i18n` when the branch needs the remaining locales. Missing keys use the English fallback until translations are merged.

### Changing an existing key's English text

`bun run i18n` translates keys that are **missing** from a locale. Editing an existing English value leaves the other locales on the old text until you regenerate that key.

When a change alters an existing key's meaning or content (not just a typo), do one of:

- Rename the key, so it is missing everywhere and gets translated fresh.
- Re-translate it in the same PR by deleting the key from the generated locales, running `bun run i18n`, and committing the keys covered by the change.
- For text that can use the English fallback, delete the stale key from the generated locales until the next translation run. Regenerate localized search keywords and other text that affects behavior in the same PR.

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
