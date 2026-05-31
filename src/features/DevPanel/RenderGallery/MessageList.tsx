'use client';

import { LOADING_FLAT } from '@lobechat/const';
import type { ChatToolPayload, UIChatMessage } from '@lobechat/types';
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

import { DEVTOOLS_AGENT_ID } from './fixtures';
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
    border-radius: 14px;

    background: ${cssVar.colorBgContainer};
  `,
}));

const coerceContent = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/**
 * Build the **flat** DB-shaped messages a real conversation produces, then let
 * `parse()` (conversation-flow, via `ConversationProvider.replaceMessages`)
 * synthesize the `assistantGroup` / tool grouping exactly as it does in chat —
 * instead of hand-rolling the grouped shape. Each render-bearing API becomes:
 *
 *   assistant { content, tools: [tool_use] }  →  tool { tool_call_id, result… }
 *
 * The whole sequence is one parentId chain so it reads as a single conversation.
 * Lifecycle state is carried on the tool result message the same way the real
 * pipeline carries it:
 *  - success  → tool message `content` + `pluginState`
 *  - error    → tool message `pluginError`
 *  - intervention → tool message `pluginIntervention.status = 'pending'`
 *  - streaming   → `LOADING_FLAT` content + unterminated `arguments` JSON on the tool_use
 *  - loading / placeholder → `LOADING_FLAT` content
 *
 * Every API emits a tool message even for the unfinished states (content
 * `LOADING_FLAT`) — the tool_use → tool_result link is what lets
 * conversation-flow chain the turns into ONE assistantGroup; without it the
 * unfinished modes fall back to one orphaned group per tool.
 */
const buildMessages = (apis: ApiEntry[], mode: LifecycleMode, now: number): UIChatMessage[] => {
  const renderable = apis.filter(
    (api) => api.render || api.streaming || api.placeholder || api.intervention,
  );

  const messages: UIChatMessage[] = [];

  for (const api of renderable) {
    const variant = api.fixture.variants[0];
    const derived = deriveFixtureProps(variant, mode);
    const key = `${api.identifier}-${api.apiName}`;
    const assistantId = `devtools-asst-${key}`;
    const toolCallId = `devtools-tool-${key}`;

    const toolUse: ChatToolPayload = {
      apiName: api.apiName,
      // Streaming: drop the closing brace so args fail to parse → "still typing".
      arguments:
        mode === 'streaming'
          ? JSON.stringify(derived.partialArgs ?? {}).replace(/\}$/, '')
          : JSON.stringify(derived.args),
      id: toolCallId,
      identifier: api.identifier,
      source: api.apiName.startsWith('mcp__') ? 'mcp' : 'builtin',
      type: 'builtin',
    };

    // Chain onto the previous turn's last message so the whole thread is one
    // conversation; the first assistant has no parent (conversation root).
    messages.push({
      content: api.description || variant.description || '',
      createdAt: now,
      id: assistantId,
      parentId: messages.at(-1)?.id,
      role: 'assistant',
      tools: [toolUse],
      updatedAt: now,
    });

    // Always emit the paired tool result — it's the tool_use → tool_result link
    // that lets conversation-flow chain every turn into ONE assistantGroup.
    // Unfinished states use LOADING_FLAT so the tool still reads as in-flight.
    messages.push({
      content: mode === 'success' ? coerceContent(derived.content) : LOADING_FLAT,
      createdAt: now,
      id: `devtools-toolmsg-${key}`,
      parentId: assistantId,
      pluginError: mode === 'error' ? derived.pluginError : undefined,
      pluginIntervention: mode === 'intervention' ? { status: 'pending' } : undefined,
      pluginState: mode === 'success' ? derived.pluginState : undefined,
      role: 'tool',
      tool_call_id: toolCallId,
      updatedAt: now,
    });
  }

  return messages;
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
 * the **real** `Conversation` renderer. Flat fixture messages are seeded through
 * `ConversationProvider` (`skipFetch`) so conversation-flow's `parse()` performs
 * the real `assistantGroup` grouping — the preview is byte-for-byte what ships
 * in chat. Inspector-only tools (most MCP entries) are dropped to keep the
 * thread about the renders.
 */
const MessageList = memo<MessageListProps>(({ apis, mode }) => {
  // One stable timestamp per (apis, mode) render so message identity is steady.
  const messages = useMemo(() => buildMessages(apis, mode, Date.now()), [apis, mode]);
  const context = useMemo<ConversationContext>(
    () => ({ agentId: DEVTOOLS_AGENT_ID, topicId: 'devtools-aggregate' }),
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
