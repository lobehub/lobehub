# Shared Style Rules

These apply across every surface.

## The component skeleton

Every surface file is the same shape, so internalize it once instead of re-deriving it per rule. The skeleton below bakes in five mechanical conventions — copy it and fill the body:

```tsx
'use client'; // (a) leaves of the chat tree must not block server rendering

import type { BuiltinInspectorProps, SearchQuery, UniformSearchResponse } from '@lobechat/types';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

// (b) type with BuiltinXProps<Args, State> — never widen to `any`.
//     Args = the JSON Schema params, State = the executor's `state` field;
//     they should match <Name>Params / <Name>State from types.ts.
export const SearchInspector = memo<BuiltinInspectorProps<SearchQuery, UniformSearchResponse>>(
  ({ args, pluginState }) => {
    const { t } = useTranslation('plugin'); // (c) all strings from the `plugin` namespace

    // (d) cross-cutting state (loading, streaming buffer) comes from the store,
    //     not props — props only carry args/state/messageId.
    // const buffer = useChatStore((s) => chatToolSelectors.streamingBuffer(messageId)(s));

    return <span>{t('builtins.<identifier>.apiName.search')}</span>;
  },
);
SearchInspector.displayName = 'SearchInspector'; // (e) always memo + displayName
export default SearchInspector;
```

- **(c)** Default an Inspector to `t('builtins.<identifier>.apiName.<api>')` so the row is non-empty while args stream in.
- **(d)** Read the store via Zustand selectors inside the component; see [streaming.md](streaming.md) for the buffer selector.

## Styling: `createStaticStyles + cssVar.*`, `@lobehub/ui` over `antd`

Zero-runtime CSS-in-JS — styles compile once and read CSS variables at runtime:

```tsx
import { createStaticStyles, cssVar } from 'antd-style';

const styles = createStaticStyles(({ css, cssVar }) => ({
  chip: css`
    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillTertiary};
  `,
}));
```

- Fall back to `createStyles + token` only when you need runtime token computation (rare). Inline `style={{ color: cssVar.colorTextSecondary }}` is fine for one-off dynamic values.
- Components come from `@lobehub/ui` (`Block`, `Text`, `Flexbox`, `Highlighter`, `Alert`, `Tooltip`, `Skeleton`), not raw `antd`. Modals come from `@lobehub/ui/base-ui` (`createModal`, `useModalContext`, `confirmModal`) — see the **modal** skill.
- Note: `<Text type='secondary'>` is a lighter shade than `colorTextSecondary`. For that exact token color, write `<Text style={{ color: cssVar.colorTextSecondary }}>`.

## Stay single-layer — don't nest filled cards

The framework already wraps every Render / Intervention in a tool card, so that card **is** your surface. A Render that opens with its own `background: ${cssVar.colorFillQuaternary}` container is already one card deep; put another filled box inside it (`colorBgContainer` / `colorFillTertiary`) and you get the card-in-card look that reads as "complex" — two or three stacked fills for what is really a flat list of fields.

- **The outermost wrapper carries no fill.** Use a flat container with only `padding-block: 4px` for breathing room; let the tool card provide the card. (See `Agent/index.tsx`'s `container`.)
- **At most one filled box, and only to delineate real content** — a Markdown preview, a diff, a code/result block. Labels, key–value fields, question/answer text, chips: render flat on the surface, separated by spacing or a hairline divider (`height: 1px; background: ${cssVar.colorFillSecondary}`), not by wrapping each in its own box.
- **A box on a flat surface needs a visible fill.** Once the outer fill is gone, an inner `colorBgContainer` box can vanish against the tool card (same color). Use `colorFillTertiary` for the one content box so it still reads as delineated.
- Don't wrap a single value in a box just to give it padding — that's the redundant-nesting smell (a `detailCard` around a `value` box around one string).

```tsx
// ❌ card-in-card: filled container wrapping a filled preview box
container: css`
  padding: 12px;
  background: ${cssVar.colorFillQuaternary};
`,
previewBox: css`
  background: ${cssVar.colorBgContainer};
`,

// ✅ single-layer: flat container, one visible content box
container: css`
  padding-block: 4px;
`,
previewBox: css`
  background: ${cssVar.colorFillTertiary};
`,
```

For the common "icon + file/title header, then one content box" shape, reuse `ToolResultCard` from `@lobechat/shared-tool-ui/components` instead of rebuilding it — it's already single-layer (flat wrapper, one `colorFillTertiary` content box) and is what CC `Read` / `Grep` / `Glob` / `Write` / `WebSearch` / `WebFetch` render through.

The exception is a deliberate **panel** pattern — an `<Block variant="outlined">` with a header bar + list rows (CC `TodoWrite` / `Task`). There the single outlined block is the panel and the header fill is a header bar, not a nested card. One structured panel is fine; stacked decorative fills are not.
