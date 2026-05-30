'use client';

import { Flexbox, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo } from 'react';

import { deriveFixtureProps, type LifecycleMode } from './lifecycleMode';
import { ToolBodySlot, ToolInspectorSlot } from './toolSurfaces';
import type { ApiEntry } from './useDevtoolsEntries';

const styles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    font-size: 14px;
    line-height: 1.7;
    color: ${cssVar.colorText};
  `,
  empty: css`
    padding-block: 48px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  item: css`
    padding-block: 20px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:last-child {
      border-block-end: none;
    }
  `,
  name: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  thread: css`
    width: 100%;
    max-width: 820px;
    margin-inline: auto;
    padding-block: 12px 48px;
    padding-inline: 28px;
  `,
  tool: css`
    margin-block-start: 10px;
    padding-inline-start: 16px;
    border-inline-start: 2px solid ${cssVar.colorBorderSecondary};
  `,
}));

interface MessageItemProps {
  api: ApiEntry;
  mode: LifecycleMode;
}

/**
 * One assistant turn in the aggregate preview: a line of content followed by
 * the tool call (Inspector chip + body), reusing the same lifecycle-derived
 * slots as the per-API view so the two tabs never drift.
 */
const MessageItem = memo<MessageItemProps>(({ api, mode }) => {
  const messageId = `devtools-msg-${api.identifier}-${api.apiName}`;
  const toolCallId = `${messageId}-tool`;
  const variant = api.fixture.variants[0];
  const derived = useMemo(() => deriveFixtureProps(variant, mode), [variant, mode]);

  const content = api.description || variant.description;

  return (
    <Flexbox className={styles.item}>
      <Flexbox horizontal align={'center'} gap={8} style={{ marginBlockEnd: 6 }}>
        <span className={styles.name}>{api.apiName}</span>
        <Tag size={'small'}>{mode}</Tag>
      </Flexbox>
      {content && <div className={styles.content}>{content}</div>}
      <Flexbox className={styles.tool} gap={8}>
        <ToolInspectorSlot api={api} derived={derived} variant={variant} />
        <ToolBodySlot
          hideMissing
          api={api}
          derived={derived}
          messageId={messageId}
          mode={mode}
          toolCallId={toolCallId}
        />
      </Flexbox>
    </Flexbox>
  );
});

MessageItem.displayName = 'DevtoolsMessageItem';

interface MessageListProps {
  apis: ApiEntry[];
  mode: LifecycleMode;
}

/**
 * Aggregate preview tab: stitches every API that ships a body surface into one
 * compact content + tool message flow, so renders can be judged in context
 * instead of in isolation. Inspector-only tools (most MCP entries) are dropped
 * to keep the thread about the renders.
 */
const MessageList = memo<MessageListProps>(({ apis, mode }) => {
  const items = apis.filter(
    (api) => api.render || api.streaming || api.placeholder || api.intervention,
  );

  return (
    <div className={styles.thread}>
      {items.length === 0 ? (
        <Text className={styles.empty}>No renderable APIs in this toolset.</Text>
      ) : (
        items.map((api) => <MessageItem api={api} key={api.apiName} mode={mode} />)
      )}
    </div>
  );
});

MessageList.displayName = 'DevtoolsMessageList';

export default MessageList;
