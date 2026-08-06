---
name: i18n
description: 'LobeHub/Aico i18n with react-i18next. Use for user-facing strings, locale keys, namespaces, useTranslation, t(), interpolation, fa-IR/fr-FR/en-US/zh-CN previews, hardcoded UI copy, or bun run i18n.'
user-invocable: false
---

# LobeHub / Aico Internationalization Guide

- Framework: react-i18next
- **Aico default language: Persian (`fa-IR`)** — see `DEFAULT_LANG` / `VISIBLE_LOCALES` in `packages/locales/src/resources.ts`
- **Visible product languages:** `fa-IR`, `en-US`, `fr-FR` (must be hand-translated in-PR)
- Author English source in `packages/locales/src/default/` — never edit generated JSON for non-visible locales by hand
- Leave non-visible locales to the daily `auto-i18n.yml` workflow by default; run `bun run i18n` only when those are needed immediately

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

## Workflow (Aico)

1. Add keys to `packages/locales/src/default/{namespace}.ts`
2. Export new namespace in `packages/locales/src/default/index.ts` when creating a namespace
3. In the **same PR**, update:
   - `locales/en-US/{namespace}.json` (English mirror)
   - `locales/fa-IR/{namespace}.json` (**required** — Persian)
   - `locales/fr-FR/{namespace}.json` (**required** — French; create the file if missing)
   - `locales/zh-CN/{namespace}.json` (hand-translate for shared upstream namespaces)
4. Leave `ar`, `de-DE`, `ja-JP`, etc. to `.github/workflows/auto-i18n.yml`
5. Run `bun run i18n` manually only when non-visible locales are needed immediately; it is slow and requires `OPENAI_API_KEY`

Do **not** ship new Aico UI copy with English-only `fa-IR` / `fr-FR` (or missing keys that fall back to English).

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

**Most used:** `common` (shared UI), `chat` (chat features), `setting` (settings), `aico` (Aico B2B/wallet/admin)

Others: auth, changelog, components, discover, editor, electron, error, file, hotkey, knowledgeBase, memory, models, plugin, portal, providers, tool, topic
