# Inspector — Header Chip (required)

**Lifecycle:** Inspector renders for **every phase** of a tool call: while args are streaming in, while the executor is running, and after results come back. It's the only surface that's always visible.

**Goal:** keep it to a single line. Show what's happening with as much context as is currently available.

## Props (`BuiltinInspectorProps<Args, State>`)

```ts
interface BuiltinInspectorProps<Arguments = any, State = any> {
  apiName: string;
  args: Arguments; // final args (only after the assistant stops streaming)
  identifier: string;
  isArgumentsStreaming?: boolean; // args still arriving
  isLoading?: boolean; // args complete, executor running
  partialArgs?: Arguments; // partial JSON during streaming
  pluginState?: State; // executor's `state` after success
  result?: { content: string | null; error?: any };
}
```

## State machine

| Phase                               | What's available                                           | What to show                                               |
| ----------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| Args streaming, no useful field yet | `isArgumentsStreaming === true`, `partialArgs.X` undefined | Just the API title with `shinyTextStyles.shinyText`        |
| Args streaming, key field arrived   | `partialArgs.X` populated                                  | Title + key field chip, still pulse-animated               |
| Args complete, executor running     | `args` populated, `isLoading === true`                     | Same as above, still pulse-animated                        |
| Result arrived                      | `pluginState` populated, `isLoading === false`             | Title + chips + result summary (count, identifier, status) |

## Canonical example — Search

`packages/builtin-tool-web-browsing/src/client/Inspector/Search/index.tsx`:

```tsx
'use client';

import type { BuiltinInspectorProps, SearchQuery, UniformSearchResponse } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { cssVar, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { highlightTextStyles, inspectorTextStyles, shinyTextStyles } from '@/styles';

export const SearchInspector = memo<BuiltinInspectorProps<SearchQuery, UniformSearchResponse>>(
  ({ args, partialArgs, isArgumentsStreaming, isLoading, pluginState }) => {
    const { t } = useTranslation('plugin');

    const query = args?.query || partialArgs?.query || '';
    const resultCount = pluginState?.results?.length ?? 0;
    const hasResults = resultCount > 0;

    if (isArgumentsStreaming && !query) {
      return (
        <div className={cx(inspectorTextStyles.root, shinyTextStyles.shinyText)}>
          <span>{t('builtins.lobe-web-browsing.apiName.search')}</span>
        </div>
      );
    }

    return (
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <span>{t('builtins.lobe-web-browsing.apiName.search')}:&nbsp;</span>
        {query && <span className={highlightTextStyles.primary}>{query}</span>}
        {!isLoading &&
          !isArgumentsStreaming &&
          pluginState?.results &&
          (hasResults ? (
            <span style={{ marginInlineStart: 4 }}>({resultCount})</span>
          ) : (
            <Text as="span" color={cssVar.colorTextDescription} fontSize={12}>
              ({t('builtins.lobe-web-browsing.inspector.noResults')})
            </Text>
          ))}
      </div>
    );
  },
);
SearchInspector.displayName = 'SearchInspector';
export default SearchInspector;
```

## Inspector rules

- Wrap the whole row with `inspectorTextStyles.root` (provides correct flex / line-height baseline).
- Pulse with `shinyTextStyles.shinyText` whenever `isArgumentsStreaming || isLoading`.
- Show the i18n title first so the row is non-empty during the earliest streaming phase.
- Read both `args?.X` and `partialArgs?.X` together — `args` is final, `partialArgs` is in-stream.
- Use chips/tags for distinct facets (identifier, name, parent, status, count). Each chip should clip with `text-overflow: ellipsis` and have a `max-width` so long values don't blow out the chat bubble.
- Append `pluginState`-derived suffixes only **after** loading finishes — count or "(no results)" should not appear while still searching.
- **Switch copy by phase.** If the verb implies an ongoing action ("Creating", "Searching", "Listing"), define `<api>.loading` and `<api>.completed` keys and select via `isArgumentsStreaming || isLoading ? loadingKey : completedKey`. Inspector chips persist in chat history — leaving "Creating task" frozen on a finished call reads as if the tool is still running. Read-only labels that are already noun-form ("View task") can keep a single key. See `CallSubAgentInspector` for the canonical two-key pattern.

## Inspector registry — `client/Inspector/index.ts`

```ts
import type { BuiltinInspector } from '@lobechat/types';

import { TaskApiName } from '../../types';
import { CreateTaskInspector } from './CreateTask';
import { ListTasksInspector } from './ListTasks';
/* … */

export const TaskInspectors: Record<string, BuiltinInspector> = {
  [TaskApiName.createTask]: CreateTaskInspector as BuiltinInspector,
  [TaskApiName.listTasks]: ListTasksInspector as BuiltinInspector,
  /* one entry per ApiName */
};

export { CreateTaskInspector } from './CreateTask';
export { ListTasksInspector } from './ListTasks';
/* re-export each */
```
