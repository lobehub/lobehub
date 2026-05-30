'use client';

import type { ChatToolPayloadWithResult, UIChatMessage } from '@lobechat/types';
import { Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo } from 'react';

import {
  type ConversationContext,
  ConversationProvider,
  MessageItem,
} from '@/features/Conversation';
import { MessageActionProvider } from '@/features/Conversation/Messages/Contexts/MessageActionProvider';
import { dataSelectors, useConversationStore } from '@/features/Conversation/store';

import { deriveFixtureProps, type LifecycleMode } from './lifecycleMode';
import type { ApiEntry } from './useDevtoolsEntries';

const styles = createStaticStyles(({ css, cssVar }) => ({
  empty: css`
    padding-block: 48px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  thread: css`
    width: 100%;
    max-width: 820px;
    margin-inline: auto;
    padding-block: 8px 48px;
    padding-inline: 12px;
  `,
}));

const coerceContent = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/**
 * Translate a fixture + lifecycle mode into the real tool payload shape the
 * conversation renderer reads. The `Tool` component derives its state purely
 * from this shape (no live operation needed):
 *  - success  → a finished `result` (content + state)
 *  - error    → `result.error`
 *  - intervention → `intervention.status = 'pending'`, no result
 *  - streaming   → intentionally-unterminated `arguments` JSON (the renderer
 *                  flags `isArgumentsStreaming` when args fail to parse)
 *  - loading / placeholder → valid args, no result yet
 */
const buildTool = (api: ApiEntry, mode: LifecycleMode): ChatToolPayloadWithResult => {
  const variant = api.fixture.variants[0];
  const derived = deriveFixtureProps(variant, mode);
  const id = `devtools-tool-${api.identifier}-${api.apiName}`;

  const argumentsJson =
    mode === 'streaming'
      ? JSON.stringify(derived.partialArgs ?? {}).replace(/\}$/, '') // drop the closing brace → "still typing"
      : JSON.stringify(derived.args);

  const result =
    mode === 'success'
      ? { content: coerceContent(derived.content), id, state: derived.pluginState }
      : mode === 'error'
        ? { content: null, error: derived.pluginError, id }
        : undefined;

  return {
    apiName: api.apiName,
    arguments: argumentsJson,
    id,
    identifier: api.identifier,
    intervention: mode === 'intervention' ? { status: 'pending' } : undefined,
    result,
    source: api.apiName.startsWith('mcp__') ? 'mcp' : 'builtin',
    type: 'builtin',
  };
};

const buildMessages = (apis: ApiEntry[], mode: LifecycleMode, now: number): UIChatMessage[] => {
  const renderable = apis.filter(
    (api) => api.render || api.streaming || api.placeholder || api.intervention,
  );

  // Thread every turn onto the previous one via `parentId` so the renderer reads
  // them as a single conversation chain, not a handful of orphaned messages.
  let parentId: string | undefined;
  return renderable.map((api) => {
    const id = `devtools-msg-${api.identifier}-${api.apiName}`;
    const message: UIChatMessage = {
      children: [
        {
          content: api.description || api.fixture.variants[0]?.description || '',
          id: `devtools-block-${api.identifier}-${api.apiName}`,
          tools: [buildTool(api, mode)],
        },
      ],
      content: '',
      createdAt: now,
      id,
      parentId,
      role: 'assistantGroup',
      updatedAt: now,
    };
    parentId = id;
    return message;
  });
};

const InnerList = memo(() => {
  const ids = useConversationStore(dataSelectors.displayMessageIds);
  return (
    <MessageActionProvider withSingletonActionsBar={false}>
      <div className={styles.thread}>
        {ids.map((id, index) => (
          <MessageItem
            disableEditing
            defaultWorkflowExpandLevel={'full'}
            id={id}
            index={index}
            key={id}
          />
        ))}
      </div>
    </MessageActionProvider>
  );
});

InnerList.displayName = 'DevtoolsAggregateInnerList';

interface MessageListProps {
  apis: ApiEntry[];
  mode: LifecycleMode;
}

/**
 * Aggregate preview tab: renders every render-bearing API as a tool call inside
 * the **real** `Conversation` message renderer (seeded via `ConversationProvider`
 * with fixture messages, `skipFetch`), so the preview is byte-for-byte what
 * ships in chat instead of a hand-rolled approximation. Inspector-only tools
 * (most MCP entries) are dropped to keep the thread about the renders.
 */
const MessageList = memo<MessageListProps>(({ apis, mode }) => {
  // One stable timestamp per (apis, mode) render so message identity is steady.
  const messages = useMemo(() => buildMessages(apis, mode, Date.now()), [apis, mode]);
  const context = useMemo<ConversationContext>(
    () => ({ agentId: 'devtools-render-gallery', topicId: 'devtools-aggregate' }),
    [],
  );

  if (messages.length === 0) {
    return <Text className={styles.empty}>No renderable APIs in this toolset.</Text>;
  }

  return (
    <ConversationProvider hasInitMessages skipFetch context={context} messages={messages}>
      <InnerList />
    </ConversationProvider>
  );
});

MessageList.displayName = 'DevtoolsMessageList';

export default MessageList;
