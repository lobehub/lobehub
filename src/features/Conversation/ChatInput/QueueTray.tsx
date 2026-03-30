'use client';

import { ActionIcon, Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ListEnd, Pencil, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';

import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { useConversationStore } from '../store';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-block-end: none;
    border-radius: 12px 12px 0 0;
    background: ${cssVar.colorBgContainer};
  `,
  icon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextDescription};
  `,
  item: css`
    padding-block: 6px 4px;
    padding-inline: 12px 8px;
  `,
  itemDivider: css`
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  text: css`
    overflow: hidden;

    font-size: 13px;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const QueueTray = memo(() => {
  const context = useConversationStore((s) => s.context);

  const contextKey = useMemo(
    () =>
      messageMapKey({
        agentId: context.agentId,
        groupId: context.groupId,
        topicId: context.topicId,
      }),
    [context.agentId, context.groupId, context.topicId],
  );

  const queuedMessages = useChatStore((s) => operationSelectors.getQueuedMessages(context)(s));
  const removeQueuedMessage = useChatStore((s) => s.removeQueuedMessage);
  const editor = useConversationStore((s) => s.editor);

  const handleEdit = useCallback(
    (msgId: string, content: string) => {
      removeQueuedMessage(contextKey, msgId);
      editor?.setDocument('markdown', content);
      editor?.focus();
    },
    [contextKey, editor, removeQueuedMessage],
  );

  if (queuedMessages.length === 0) return null;

  return (
    <Flexbox className={styles.container} gap={0}>
      {queuedMessages.map((msg, index) => (
        <Flexbox
          horizontal
          align="center"
          className={index > 0 ? `${styles.item} ${styles.itemDivider}` : styles.item}
          gap={8}
          key={msg.id}
        >
          <Icon className={styles.icon} icon={ListEnd} size={14} />
          <Flexbox className={styles.text} flex={1}>
            {msg.content}
          </Flexbox>
          <ActionIcon icon={Pencil} size="small" onClick={() => handleEdit(msg.id, msg.content)} />
          <ActionIcon
            icon={Trash2}
            size="small"
            onClick={() => removeQueuedMessage(contextKey, msg.id)}
          />
        </Flexbox>
      ))}
    </Flexbox>
  );
});

QueueTray.displayName = 'QueueTray';

export default QueueTray;
