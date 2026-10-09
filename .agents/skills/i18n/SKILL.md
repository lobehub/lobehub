---
name: i18n
description: 'Use for user-facing strings and react-i18next locale keys, namespaces, interpolation, translations or bun run i18n.'
user-invocable: false
---

# LobeHub Internationalization Guide

- Default language: English (en-US)
- Framework: react-i18next
- **Only edit files in `packages/locales/src/default/`** - Never edit JSON files in `locales/` (except hand-written en-US/zh-CN previews)
- Leave generated locales to the daily `auto-i18n.yml` workflow by default; run `bun run i18n` manually only when they are needed immediately

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
4. Leave all other locales to `.github/workflows/auto-i18n.yml`, which runs daily and opens an automated translation PR
5. Run `bun run i18n` manually only when the branch needs those translations immediately; it is slow and requires `OPENAI_API_KEY`

### Changing an existing key's English text

`lobe-i18n` (both the daily workflow and `bun run i18n`) only translates keys that are **missing** from a locale. It never re-translates a key whose English value changed, so editing an existing value leaves every generated locale on the old text indefinitely (e.g. expanded `settingsSearch.tabKeywords.*` stayed stale in 16 locales for weeks).

When a change alters an existing key's meaning or content (not just a typo), do one of:

- Rename the key, so it is missing everywhere and gets translated fresh.
- Re-translate it in the same PR: delete the key from every generated `locales/*/{namespace}.json` (all except en-US/zh-CN), run `bun run i18n`, and commit **only** those keys — the run also fills unrelated missing keys, which belong to the daily workflow PR.
- If the stale translation is harmless until the daily run, delete the key from the generated locales so they fall back to English and the workflow re-translates it. Do not do this when the localized text is load-bearing (e.g. search keywords users type in their own language).

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
