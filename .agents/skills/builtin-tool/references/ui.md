# Tool UI Surfaces

A builtin tool can ship up to **six client-side surfaces**, each with a different role in the chat UI. Only `Inspector` is required; the other five are added on demand and registered in their own central files.

| Surface      | Required? | When the chat shows it                                                | Registered in                                 |
| ------------ | --------- | --------------------------------------------------------------------- | --------------------------------------------- |
| Inspector    | ✅ Always | Header strip of every tool call (one-line chip)                       | `packages/builtin-tools/src/inspectors.ts`    |
| Render       | Optional  | Rich result card below the header, after the call returns             | `packages/builtin-tools/src/renders.ts`       |
| Placeholder  | Optional  | Skeleton between "args streaming complete" and "result arrives"       | `packages/builtin-tools/src/placeholders.ts`  |
| Streaming    | Optional  | Live output during execution (e.g. command stdout)                    | `packages/builtin-tools/src/streamings.ts`    |
| Intervention | Optional  | Approval / edit-before-run dialog (when `humanIntervention` triggers) | `packages/builtin-tools/src/interventions.ts` |
| Portal       | Optional  | Full-screen detail view (right-side or modal)                         | `packages/builtin-tools/src/portals.ts`       |

The two reference tools to read end-to-end:

- **`builtin-tool-web-browsing/src/client/`** — Inspector + Render + Placeholder + Portal (no Intervention/Streaming).
- **`builtin-tool-local-system/src/client/`** — all six surfaces, including `components/` for shared building blocks.

---

## Tool Render 设计原则（中文草案）

这些原则用于判断一个 builtin tool 的 Inspector / Render / Placeholder / Streaming / Intervention / Portal 应该做什么，以及做到什么程度。

1. **先保证折叠态可读。** 每个 API 都必须有 Inspector；用户不展开也应该能看懂 “正在做什么 / 对什么做 / 当前结果是什么”。Inspector 不应该只展示函数名和原始参数。
2. **Inspector 是一句话，不是详情页。** 优先表达动作、关键对象、数量、状态，例如 “分析图片 3 张”“搜索 12 个结果”“读取 config.json”。长文本、列表和结构化结果放到 Render 或 Portal。
3. **Inspector 要覆盖执行生命周期。** `args` 还在 streaming、工具执行中、执行完成、执行失败时都应该有稳定展示；必要时同时读取 `args`、`partialArgs` 和 `pluginState`，避免出现空白、跳变或只显示半截参数。
4. **只有结构化结果才需要 Render。** 如果工具结果只是自然语言总结，通常不需要 Render；如果结果包含列表、媒体、文件、表格、代码、diff、地图、时间线、权限请求等结构，就应该提供 Render。
5. **Render 要帮助用户检查结果，而不是复述参数。** Render 的主体应该围绕工具产物组织：可预览、可比较、可筛选、可定位。参数只作为上下文辅助出现，不要把 Render 做成一块更大的 args dump。
6. **参数和结果要一起参与渲染。** 好的 Tool UI 通常同时用 `args` 解释意图，用 `pluginState` 展示真实执行结果；但 `pluginState` 只放结果域数据，不要反向塞入可以从 `args` 推导出的内容。
7. **慢操作要有 Placeholder。** 如果工具通常需要等待网络、文件系统、模型或外部进程，Placeholder 应该先占住最终 Render 的版式，让用户知道即将看到什么，而不是只显示一个泛化 loading。
8. **Streaming 只用于连续产物。** 搜索列表、日志、长文本、文件分析、分阶段计划适合 Streaming；一次性小结果不需要强行做 Streaming。Streaming UI 要能渐进追加，并且完成后自然过渡到最终 Render。
9. **有风险的动作必须 Intervention。** 写文件、删除、发送、安装、执行命令、外部可见操作、权限敏感操作，都应该在执行前给出可理解的确认界面；确认文案要说明影响范围，而不是只问 “是否继续”。
10. **错误、空态和截断都是正式状态。** Render 不能在失败、无结果、超长结果时退化成空白。错误要说明发生在哪一步；空态要告诉用户没有产物；超长内容要明确 “展示前 N 项 / 还有 N 项”。
11. **信息密度要克制。** 默认展示最有判断价值的部分：标题、来源、状态、摘要、少量关键字段。大对象、长列表、原文、调试数据放进可展开区域或 Portal，避免把聊天流撑成后台管理页。
12. **视觉上融入聊天流。** Tool UI 应该使用 `@lobehub/ui` / base-ui、`Flexbox`、`createStaticStyles` 和 `cssVar.*`，遵循现有间距、圆角、颜色、字号；不要为单个工具发明一套独立视觉语言。
13. **Devtools fixture 是验收入口。** 新增或修改 Tool UI 时，应在 `/devtools` 里准备覆盖典型态、loading/streaming、空态、错误态、长内容态的 fixture；一个 API 如果在真实聊天里会出现，就不应该在 devtools 中缺席。
14. **先做用户会看的 UI，再做调试 UI。** Raw JSON、trace、schema、内部 id 可以存在，但应默认收起或放到调试区；主界面先回答用户最关心的问题：工具做了什么，结果值不值得信任，下一步能做什么。

---

## 0. Shared Style Rules

These apply across every surface.

### 0.1 Use `'use client'` at the top of every component file

Tool surfaces are leaves in the chat tree and must not block server rendering.

### 0.2 Prefer `createStaticStyles + cssVar.*`

Zero-runtime CSS-in-JS — the styles compile once and read CSS variables at runtime.

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

Fall back to `createStyles + token` only when you need runtime token computation (rare). Inline `style={{ color: cssVar.colorTextSecondary }}` is fine for one-off dynamic values.

### 0.3 Use `@lobehub/ui`, not raw `antd`

`Block`, `Text`, `Flexbox`, `Highlighter`, `Alert`, `Tooltip`, `Skeleton` all come from `@lobehub/ui`. Modals come from `@lobehub/ui/base-ui` (`createModal`, `useModalContext`, `confirmModal`) — see the **modal** skill.

Memory note: `@lobehub/ui`'s `<Text type='secondary'>` is a lighter shade than `colorTextSecondary`. If you need that exact token color, write `<Text style={{ color: cssVar.colorTextSecondary }}>`.

### 0.4 Always `memo` and set `displayName`

```tsx
export const SearchInspector = memo<BuiltinInspectorProps<SearchQuery, UniformSearchResponse>>(
  ({ args /* … */ }) => {
    /* … */
  },
);
SearchInspector.displayName = 'SearchInspector';
export default SearchInspector;
```

### 0.5 Always type with `BuiltinXProps<Args, State>` generics

Don't widen to `any`. The Args generic is the JSON Schema params, the State generic is the executor's `state` field. The two should match `<Name>Params` and `<Name>State` from `types.ts`.

### 0.6 Pull strings from `t('plugin')`

```tsx
const { t } = useTranslation('plugin');
t('builtins.<identifier>.apiName.<api>');
```

Every Inspector should default to `t('builtins.<identifier>.apiName.<api>')` so it shows something while args stream in.

### 0.7 Read store state from `@/store/chat`, not props

Tool surfaces sometimes need cross-cutting state (loading, streaming buffer). Read it inside the component via Zustand selectors, not from props — props only carry args/state/messageId.

---

## 1. Inspector — Header Chip (required)

**Lifecycle:** Inspector renders for **every phase** of a tool call: while args are streaming in, while the executor is running, and after results come back. It's the only surface that's always visible.

**Goal:** keep it to a single line. Show what's happening with as much context as is currently available.

### Props (`BuiltinInspectorProps<Args, State>`)

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

### State machine

| Phase                               | What's available                                           | What to show                                               |
| ----------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| Args streaming, no useful field yet | `isArgumentsStreaming === true`, `partialArgs.X` undefined | Just the API title with `shinyTextStyles.shinyText`        |
| Args streaming, key field arrived   | `partialArgs.X` populated                                  | Title + key field chip, still pulse-animated               |
| Args complete, executor running     | `args` populated, `isLoading === true`                     | Same as above, still pulse-animated                        |
| Result arrived                      | `pluginState` populated, `isLoading === false`             | Title + chips + result summary (count, identifier, status) |

### Canonical example — Search

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

### Inspector rules

- Wrap the whole row with `inspectorTextStyles.root` (provides correct flex / line-height baseline).
- Pulse with `shinyTextStyles.shinyText` whenever `isArgumentsStreaming || isLoading`.
- Show the i18n title first so the row is non-empty during the earliest streaming phase.
- Read both `args?.X` and `partialArgs?.X` together — `args` is final, `partialArgs` is in-stream.
- Use chips/tags for distinct facets (identifier, name, parent, status, count). Each chip should clip with `text-overflow: ellipsis` and have a `max-width` so long values don't blow out the chat bubble.
- Append `pluginState`-derived suffixes only **after** loading finishes — count or "(no results)" should not appear while still searching.

### Inspector registry — `client/Inspector/index.ts`

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

---

## 2. Render — Rich Result Card (optional)

**Lifecycle:** rendered **once the result arrives** (after Placeholder/Streaming hand off). Sits below the Inspector header.

**Skip if** the API is read-only or the result is just text — the framework already shows the executor's `content` string. Add a Render only when there's a structured artifact worth seeing: a card, a chart, a diff, a list of files.

### Props (`BuiltinRenderProps<Args, State, Content>`)

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

### Two patterns

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

### Error handling in Render

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

### Render rules

- **Return `null`** if there's nothing useful to draw yet (avoids empty cards during stream).
- Use `pluginState` for server-truth (ids, counts, server-assigned status) and `args` for what the LLM asked. **Combine — neither alone is enough.**
- For lists, summarize with a header line and show top N items with a "+N more" tail rather than rendering everything.
- For modals from a Render, use `@lobehub/ui/base-ui` (`createModal`, `useModalContext`, `confirmModal`) — see the **modal** skill.

### Render registry — `client/Render/index.ts`

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

### Render display control (rare)

If the Render should hide for certain results (e.g. ClaudeCode's TodoWrite hides when the agent is mid-stream), add a `RenderDisplayControl` to `packages/builtin-tools/src/displayControls.ts`. See `ClaudeCodeRenderDisplayControls` for the pattern.

---

## 3. Placeholder — Skeleton Between Args and Result (optional)

**Lifecycle:** rendered when the args have finished streaming but the executor hasn't returned yet. Disappears when `pluginState` arrives. Bridges the moment of perceived lag.

**Add for** APIs with noticeable execution time: web search, network crawl, file list, large grep. **Skip for** instant ops (status flips, calculator).

### Props (`BuiltinPlaceholderProps<Args>`)

```ts
interface BuiltinPlaceholderProps<T extends Record<string, any> = any> {
  apiName: string;
  args?: T;
  identifier: string;
}
```

No `pluginState` — Placeholder lives entirely in the "executing" gap.

### Canonical example — Search Placeholder

`packages/builtin-tool-web-browsing/src/client/Placeholder/Search.tsx`:

```tsx
import type { BuiltinPlaceholderProps, SearchQuery } from '@lobechat/types';
import { Flexbox, Icon, Skeleton } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { SearchIcon } from 'lucide-react';
import { memo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';
import { shinyTextStyles } from '@/styles';

const styles = createStaticStyles(({ css, cssVar }) => ({
  query: cx(
    css`
      padding: 4px 8px;
      border-radius: 8px;
      font-size: 12px;
      color: ${cssVar.colorTextSecondary};
      &:hover {
        background: ${cssVar.colorFillTertiary};
      }
    `,
    shinyTextStyles.shinyText,
  ),
}));

export const Search = memo<BuiltinPlaceholderProps<SearchQuery>>(({ args }) => {
  const { query } = args || {};
  const isMobile = useIsMobile();

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal={!isMobile} gap={isMobile ? 8 : 40}>
        <Flexbox horizontal align="center" className={styles.query} gap={8}>
          <Icon icon={SearchIcon} />
          {query ? query : <Skeleton.Block active style={{ height: 20, width: 40 }} />}
        </Flexbox>
        <Skeleton.Block active style={{ height: 20, width: 40 }} />
      </Flexbox>
      <Flexbox horizontal gap={12}>
        {[1, 2, 3, 4, 5].map((id) => (
          <Skeleton.Button active key={id} style={{ borderRadius: 8, height: 80, width: 160 }} />
        ))}
      </Flexbox>
    </Flexbox>
  );
});
```

### Placeholder rules

- **Mirror the eventual Render's layout.** When the result arrives the Placeholder unmounts and the Render mounts; if they share dimensions, the chat doesn't jump.
- Use `Skeleton.Block` / `Skeleton.Button` from `@lobehub/ui` for placeholder shapes.
- Embed any args you have (e.g. the query text) — context helps the user know what's loading.
- Pulse with `shinyTextStyles.shinyText` if the Placeholder includes literal text.

### Placeholder registry — `client/Placeholder/index.ts`

```ts
import { WebBrowsingApiName } from '../../types';
import CrawlMultiPages from './CrawlMultiPages';
import CrawlSinglePage from './CrawlSinglePage';
import { Search } from './Search';

export const WebBrowsingPlaceholders = {
  [WebBrowsingApiName.crawlMultiPages]: CrawlMultiPages,
  [WebBrowsingApiName.crawlSinglePage]: CrawlSinglePage,
  [WebBrowsingApiName.search]: Search,
};

export { CrawlMultiPages, CrawlSinglePage, Search };
```

---

## 4. Streaming — Live Output During Execution (optional)

**Lifecycle:** rendered **while the executor is still running** for APIs that emit incremental output. The component is responsible for fetching the in-flight stream from the chat store and rendering it.

**Add for** long-running ops with continuous output: shell command execution (stdout/stderr), file write progress, code interpreter cells.

### Props (`BuiltinStreamingProps<Args>`)

```ts
interface BuiltinStreamingProps<Arguments = any> {
  apiName: string;
  args: Arguments;
  identifier: string;
  messageId: string; // use to fetch the streaming buffer from store
  toolCallId: string;
}
```

Note there's **no `state` or `result` prop** — the Streaming component is for the in-flight phase. It pulls the live buffer from the store itself (typically via `chatToolSelectors.streamingContent(messageId)` or similar).

### Canonical example — RunCommandStreaming

`packages/builtin-tool-local-system/src/client/Streaming/RunCommand/index.tsx`:

```tsx
'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { Highlighter } from '@lobehub/ui';
import { memo } from 'react';

interface RunCommandParams {
  command?: string;
  description?: string;
  timeout?: number;
}

export const RunCommandStreaming = memo<BuiltinStreamingProps<RunCommandParams>>(({ args }) => {
  const { command } = args || {};
  if (!command) return null;

  return (
    <Highlighter
      animated
      wrap
      language="sh"
      showLanguage={false}
      style={{ padding: '4px 8px' }}
      variant="outlined"
    >
      {command}
    </Highlighter>
  );
});
RunCommandStreaming.displayName = 'RunCommandStreaming';
```

For real-time output beyond just the command (stderr/stdout streaming), pull from the chat store:

```tsx
const buffer = useChatStore((state) =>
  chatToolSelectors.streamingBuffer(messageId, toolCallId)(state),
);
```

### Streaming rules

- Render `null` until you have something to display (avoids flash).
- For terminal-style output, use `Highlighter` with `animated` to show typing-like effect.
- The Streaming component must **unmount cleanly** when execution ends — typically the framework swaps it out for the Render automatically.

### Streaming registry — `client/Streaming/index.ts`

```ts
import { LocalSystemApiName } from '../..';
import { RunCommandStreaming } from './RunCommand';
import { WriteFileStreaming } from './WriteFile';

export const LocalSystemStreamings = {
  [LocalSystemApiName.runCommand]: RunCommandStreaming,
  [LocalSystemApiName.writeLocalFile]: WriteFileStreaming,
};
```

---

## 5. Intervention — Approval / Edit-Before-Run (optional)

**Lifecycle:** rendered **before the executor runs** for APIs whose manifest sets `humanIntervention`. The user sees a preview of the args, can edit them, then approves or skips/cancels.

**Add for** destructive or sensitive ops: shell commands, file writes, file moves, payments, message broadcasts.

### Props (`BuiltinInterventionProps<Args>`)

```ts
interface BuiltinInterventionProps<Arguments = any> {
  apiName?: string;
  args: Arguments;
  identifier?: string;
  interactionMode?: 'approval' | 'custom';
  messageId: string;

  /** Called when the user edits the args; the approve action awaits this. */
  onArgsChange?: (args: Arguments) => void | Promise<void>;

  /** Called on approve / skip / cancel. */
  onInteractionAction?: (
    action:
      | { type: 'submit'; payload: Record<string, unknown> }
      | { type: 'skip'; payload?: Record<string, unknown>; reason?: string }
      | { type: 'cancel'; payload?: Record<string, unknown> },
  ) => Promise<void>;

  /** Register a callback to flush pending saves before approval. Returns cleanup. */
  registerBeforeApprove?: (id: string, callback: () => void | Promise<void>) => () => void;
}
```

### Canonical example — RunCommand Intervention

`packages/builtin-tool-local-system/src/client/Intervention/RunCommand/index.tsx`:

```tsx
import type { RunCommandParams } from '@lobechat/electron-client-ipc';
import type { BuiltinInterventionProps } from '@lobechat/types';
import { Flexbox, Highlighter, Text } from '@lobehub/ui';
import { memo } from 'react';

const RunCommand = memo<BuiltinInterventionProps<RunCommandParams>>(({ args }) => {
  const { description, command, timeout } = args;
  return (
    <Flexbox gap={8}>
      <Flexbox horizontal justify="space-between">
        {description && <Text>{description}</Text>}
        {timeout && (
          <Text style={{ fontSize: 12 }} type="secondary">
            timeout: {formatTimeout(timeout)}
          </Text>
        )}
      </Flexbox>
      {command && (
        <Highlighter wrap language="sh" showLanguage={false} variant="outlined">
          {command}
        </Highlighter>
      )}
    </Flexbox>
  );
});
export default RunCommand;
```

### Intervention rules

- **Show a preview, not a form by default.** Editing UI is opt-in via `onArgsChange` and is usually inline (click to edit a code block, etc.).
- For args with debounced edit state (text fields), use `registerBeforeApprove(id, flushFn)` so the approve action waits for the debounce to flush. Always return the cleanup function.
- Call `onInteractionAction({ type: 'submit', payload })` when the user approves; `'skip'` if they skip with a reason; `'cancel'` if they cancel the whole turn.
- Add a corresponding `interventionAudit.ts` in the package root if the tool needs scope/path validation before approval (see `local-system/src/interventionAudit.ts`).

### Intervention registry — `client/Intervention/index.ts`

```ts
import { LocalSystemApiName } from '../..';
import EditLocalFile from './EditLocalFile';
import RunCommand from './RunCommand';
import WriteFile from './WriteFile';
/* … */

export const LocalSystemInterventions = {
  [LocalSystemApiName.editLocalFile]: EditLocalFile,
  [LocalSystemApiName.runCommand]: RunCommand,
  [LocalSystemApiName.writeLocalFile]: WriteFile,
  /* one entry per API that needs approval */
};
```

---

## 6. Portal — Full-Screen Detail View (optional)

**Lifecycle:** rendered when the user opens the tool message in a side panel or full-screen modal. One Portal per **tool**, not per API — the Portal switches on `apiName` internally.

**Add for** tools whose results deserve a deep-dive view: search results with editable filters, page content with reader mode, code interpreter sessions.

### Props (`BuiltinPortalProps<Args, State>`)

```ts
interface BuiltinPortalProps<Arguments = Record<string, any>, State = any> {
  apiName?: string;
  arguments: Arguments;
  identifier: string;
  messageId: string;
  state: State;
}
```

### Canonical example — Web-Browsing Portal

`packages/builtin-tool-web-browsing/src/client/Portal/index.tsx`:

```tsx
import type { BuiltinPortalProps, CrawlPluginState, SearchQuery } from '@lobechat/types';
import { memo } from 'react';

import { WebBrowsingApiName } from '../../types';
import PageContent from './PageContent';
import PageContents from './PageContents';
import Search from './Search';

const Portal = memo<BuiltinPortalProps>(({ arguments: args, messageId, state, apiName }) => {
  switch (apiName) {
    case WebBrowsingApiName.search:
      return <Search messageId={messageId} query={args as SearchQuery} response={state} />;

    case WebBrowsingApiName.crawlSinglePage: {
      const result = (state as CrawlPluginState).results.find((r) => r.originalUrl === args.url);
      return <PageContent messageId={messageId} result={result} />;
    }

    case WebBrowsingApiName.crawlMultiPages:
      return (
        <PageContents
          messageId={messageId}
          results={(state as CrawlPluginState).results}
          urls={args.urls}
        />
      );
  }
  return null;
});
export default Portal;
```

### Portal rules

- One Portal per tool — the file is the routing layer, subcomponents implement each API's view.
- Portals can read the chat store directly to detect "still streaming" and render a Skeleton internally (see `Search/index.tsx:20-46`).
- Layout assumes more space than the Render — use `Flexbox` with `height={'100%'}` and structure for a side panel viewport.

### Portal registry — `packages/builtin-tools/src/portals.ts`

```ts
import { WebBrowsingManifest, WebBrowsingPortal } from '@lobechat/builtin-tool-web-browsing/client';
import { type BuiltinPortal } from '@lobechat/types';

export const BuiltinToolsPortals: Record<string, BuiltinPortal> = {
  [WebBrowsingManifest.identifier]: WebBrowsingPortal as BuiltinPortal,
};
```

---

## 7. `client/components/` — Shared Subcomponents

Cross-cutting building blocks used by multiple surfaces live here, not duplicated in each surface folder.

Examples from `web-browsing/src/client/components/`:

- `CategoryAvatar.tsx` — search category icon
- `EngineAvatar.tsx` — search engine logo (used in Inspector chip + Render list + Portal header)
- `SearchBar.tsx` — editable query bar (used in Render and Portal)

Examples from `local-system/src/client/components/`:

- `FileItem.tsx` — single file row (used in ListFiles Render, SearchFiles Render, MoveLocalFiles Render)
- `FilePathDisplay.tsx` — path with truncation (used everywhere)

### Rules

- Live under `client/components/`, exported via `client/components/index.ts`.
- Re-export from `client/index.ts` only if other packages need them; otherwise keep internal.
- Keep them dumb — props in, JSX out, no store reads. The store reads belong in the surface that composes them.

---

## 8. `client/index.ts` — Package Public API

Re-exports everything the registries need plus useful types/manifest:

```ts
// Inspector — required
export { TaskInspectors } from './Inspector';

// Render — only if any API has one
export { TaskRenders, CreateTaskRender, RunTasksRender } from './Render';

// Placeholder / Streaming / Intervention — only if used
export { LocalSystemListFilesPlaceholder, LocalSystemSearchFilesPlaceholder } from './Placeholder';
export { LocalSystemStreamings } from './Streaming';
export { LocalSystemInterventions } from './Intervention';

// Portal — single export per tool
export { default as WebBrowsingPortal } from './Portal';

// Reusable components if other packages need them
export { CategoryAvatar, EngineAvatar, SearchBar } from './components';

// Re-export manifest, identifier, types for convenience
export { TaskManifest, TaskIdentifier } from '../manifest';
export * from '../types';
```

---

## 9. Diagnostic Quick-Lookup

| Symptom                                         | Surface to check                                                                                                  |     |                           |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --- | ------------------------- |
| No header at all on the tool call               | Inspector missing from `client/Inspector/index.ts` registry                                                       |     |                           |
| Header shows the API name but no chips          | Inspector missing \`args?.X                                                                                       |     | partialArgs?.X\` fallback |
| Header doesn't pulse during loading             | Missing `shinyTextStyles.shinyText` on `isArgumentsStreaming \|\| isLoading`                                      |     |                           |
| Empty result card under header                  | Render returned `<div />` instead of `null` when no data                                                          |     |                           |
| Layout jump when result arrives                 | Placeholder dimensions don't match Render dimensions                                                              |     |                           |
| Approval dialog never appears                   | Manifest missing `humanIntervention`, or Intervention not in registry                                             |     |                           |
| Approval click doesn't wait for inline edit     | Missing `registerBeforeApprove(id, flushFn)`                                                                      |     |                           |
| Portal opens but blank                          | Switch in `Portal/index.tsx` doesn't cover the apiName                                                            |     |                           |
| Strings show as `builtins.lobe-foo.apiName.bar` | Missing i18n key in `src/locales/default/plugin.ts` (or not seeded in dev locale files)                           |     |                           |
| Wrong color shade on `<Text type="secondary">`  | `type='secondary'` is lighter than `colorTextSecondary` — pass via `style={{ color: cssVar.colorTextSecondary }}` |     |                           |
