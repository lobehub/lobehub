# Render — Rich Result Card (optional)

**Lifecycle:** rendered **once the result arrives** (after Placeholder/Streaming hand off). Sits below the Inspector header.

**Skip if** the API is read-only or the result is just text — the framework already shows the executor's `content` string. Add a Render only when there's a structured artifact worth seeing: a card, a chart, a diff, a list of files.

## Props (`BuiltinRenderProps<Args, State, Content>`)

```ts
interface BuiltinRenderProps<Arguments = any, State = any, Content = any> {
  apiName?: string;
  args: Arguments; // final params from the LLM
  content: Content; // executor's content string (or parsed)
  identifier?: string;
  messageId: string; // for store lookups
  pluginError?: any; // from BuiltinToolResult.error
  pluginState?: State; // executor's state
  toolCallId?: string;
}
```

## Two patterns

**Pattern A — Single-file Render** (web-browsing CrawlSinglePage):

```tsx
// client/Render/CrawlSinglePage.tsx
import type { BuiltinRenderProps, CrawlPluginState, CrawlSinglePageQuery } from '@lobechat/types';
import { memo } from 'react';

import PageContent from './PageContent';

const CrawlSinglePage = memo<BuiltinRenderProps<CrawlSinglePageQuery, CrawlPluginState>>(
  ({ messageId, pluginState, args }) => (
    <PageContent messageId={messageId} results={pluginState?.results} urls={[args?.url]} />
  ),
);
export default CrawlSinglePage;
```

**Pattern B — Folder with subcomponents** (web-browsing Search):

```
client/Render/Search/
├── index.tsx           # composes the subcomponents, handles error states
├── ConfigForm.tsx      # appears when pluginError.type === 'PluginSettingsInvalid'
├── SearchQuery.tsx     # editable query header
└── SearchResult.tsx    # result list
```

Use Pattern B when the Render has internal state (editing mode, expanded items), error variants, or is large enough to benefit from splitting.

## Error handling in Render

Renders are the canonical place to surface `pluginError` because the chat doesn't auto-render typed errors:

```tsx
if (pluginError) {
  if (pluginError?.type === 'PluginSettingsInvalid') {
    return <ConfigForm id={messageId} provider={pluginError.body?.provider} />;
  }
  return (
    <Alert
      title={pluginError?.message}
      type="error"
      extra={<Highlighter language="json">{JSON.stringify(pluginError.body, null, 2)}</Highlighter>}
    />
  );
}
```

## Render rules

- **Return `null`** if there's nothing useful to draw yet (avoids empty cards during stream).
- Use `pluginState` for server-truth (ids, counts, server-assigned status) and `args` for what the LLM asked. **Combine — neither alone is enough.**
- For lists, summarize with a header line and show top N items with a "+N more" tail rather than rendering everything.
- **Keep the Render single-layer** — the tool card is already your surface, so don't open with your own filled container and then nest more filled boxes inside it. See [shared-rules.md](shared-rules.md) → "Stay single-layer".
- For modals from a Render, use `@lobehub/ui/base-ui` (`createModal`, `useModalContext`, `confirmModal`) — see the **modal** skill.

## Render registry — `client/Render/index.ts`

```ts
import type { BuiltinRender } from '@lobechat/types';

import { TaskApiName } from '../../types';
import CreateTaskRender from './CreateTask';
import RunTasksRender from './RunTasks';

export const TaskRenders: Record<string, BuiltinRender> = {
  [TaskApiName.createTask]: CreateTaskRender as BuiltinRender,
  [TaskApiName.runTasks]: RunTasksRender as BuiltinRender,
  /* only the APIs with rich result UI — others fall back to text content */
};

export { default as CreateTaskRender } from './CreateTask';
export { default as RunTasksRender } from './RunTasks';
```

## Render display control (rare)

If the Render should hide for certain results (e.g. ClaudeCode's TodoWrite hides when the agent is mid-stream), add a `RenderDisplayControl` to `packages/builtin-tools/src/displayControls.ts`. See `ClaudeCodeRenderDisplayControls` for the pattern.
