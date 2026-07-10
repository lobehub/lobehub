'use client';

import { ActionIcon, Flexbox, Icon, Image } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ArrowUp, ListEnd, Pencil, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message as antdMessage } from '@/components/AntdStaticMethods';
import FileIcon from '@/components/FileIcon';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import {
  type QueuedFile,
  type QueuedMessage,
  reconstructUploadFilesFromQueue,
} from '@/store/chat/slices/operation/types';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useFileStore } from '@/store/file';

import { useConversationStore } from '../store';

const PREVIEW_SIZE = 28;

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    border: 1px solid ${cssVar.colorFillSecondary};
    border-block-end: none;
    border-radius: 12px 12px 0 0;
    background: ${cssVar.colorBgElevated};
  `,
  fileChip: css`
    overflow: hidden;
    flex-shrink: 0;

    max-width: 160px;
    height: 28px;
    padding-block: 0;
    padding-inline: 6px;
    border: 1px solid ${cssVar.colorFillTertiary};
    border-radius: 6px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;
  `,
  fileChipName: css`
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  icon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextDescription};
  `,
  imageThumb: css`
    flex-shrink: 0;

    width: 28px !important;
    height: 28px !important;
    margin-block: 0 !important;
    border: 1px solid ${cssVar.colorFillTertiary};
    border-radius: 6px;

    box-shadow: none;

    img {
      width: 28px !important;
      height: 28px !important;
      object-fit: cover;
    }
  `,
  item: css`
    padding-block: 6px 4px;
    padding-inline: 12px 8px;
  `,
  itemDivider: css`
    border-block-start: 1px solid ${cssVar.colorFillTertiary};
  `,
  text: css`
    overflow: hidden;

    font-size: 13px;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const isImageFile = (f: QueuedFile) => f.mimeType.startsWith('image') && !!f.url;

interface QueuedFilePreviewProps {
  file: QueuedFile;
}

const QueuedFilePreview = memo<QueuedFilePreviewProps>(({ file }) => {
  if (isImageFile(file)) {
    // Use @lobehub/ui Image so click-to-zoom preview works. Lock both wrapper
    // and inner <img> to PREVIEW_SIZE — `size` alone doesn't constrain the
    // intrinsic image dimensions inside a flex row.
    return (
      <Image
        alt={file.name}
        classNames={{ wrapper: styles.imageThumb }}
        objectFit={'cover'}
        size={PREVIEW_SIZE}
        src={file.url}
        title={file.name}
        variant={'borderless'}
        styles={{
          image: { height: PREVIEW_SIZE, width: PREVIEW_SIZE },
          wrapper: { height: PREVIEW_SIZE, width: PREVIEW_SIZE },
        }}
      />
    );
  }

  return (
    <Flexbox horizontal align={'center'} className={styles.fileChip} gap={4} title={file.name}>
      <FileIcon fileName={file.name} fileType={file.mimeType} size={14} />
      <span className={styles.fileChipName}>{file.name}</span>
    </Flexbox>
  );
});

QueuedFilePreview.displayName = 'QueuedFilePreview';

const QueueTray = memo(() => {
  const { t } = useTranslation('chat');
  const context = useConversationStore((s) => s.context);

  // Key off the FULL context (threadId / scope / documentId / ...) so remove /
  // edit / send-now target the same bucket the queue is stored under and
  // getQueuedMessages reads from. A reduced agentId/groupId/topicId key would
  // operate on the wrong bucket for thread / page / group_agent conversations.
  // Pass the fields explicitly (not the `context` object, which may be a fresh
  // ref each render) so the memo deps stay stable primitives.
  const contextKey = useMemo(
    () =>
      messageMapKey({
        agentId: context.agentId,
        documentId: context.documentId,
        groupId: context.groupId,
        isNew: context.isNew,
        scope: context.scope,
        subAgentId: context.subAgentId,
        threadId: context.threadId,
        topicId: context.topicId,
      }),
    [
      context.agentId,
      context.documentId,
      context.groupId,
      context.isNew,
      context.scope,
      context.subAgentId,
      context.threadId,
      context.topicId,
    ],
  );

  const queuedMessages = useChatStore((s) => operationSelectors.getQueuedMessages(context)(s));
  const removeQueuedMessage = useChatStore((s) => s.removeQueuedMessage);
  const removeGatewayQueuedMessage = useChatStore((s) => s.removeGatewayQueuedMessage);
  const dispatchChatUploadFileList = useFileStore((s) => s.dispatchChatUploadFileList);
  const editor = useConversationStore((s) => s.editor);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());

  // Edit: restore both the text content AND the attached files back to the
  // input area, so the user can tweak the message and re-send. Without the
  // file restore, images attached to a queued message would silently disappear
  // when the user clicks the pencil.
  const handleEdit = useCallback(
    async (msg: QueuedMessage) => {
      if (pendingIds.has(msg.id)) return;
      setPendingIds((ids) => new Set(ids).add(msg.id));

      try {
        if (msg.source === 'gateway') {
          const removed = await removeGatewayQueuedMessage(context, msg.id);
          // The server may already have consumed the item on another device.
          // In that case, do not restore a duplicate draft into the editor.
          if (!removed) return;
        } else {
          removeQueuedMessage(contextKey, msg.id);
        }

        // Restore only after the authoritative removal succeeds. A failed
        // mutation leaves the queue item intact and avoids duplicating it in
        // both the server queue and the editor.
        editor?.setDocument('markdown', msg.content);
        editor?.focus();
        if (msg.filesPreview?.length) {
          const restored = reconstructUploadFilesFromQueue(msg.filesPreview);
          dispatchChatUploadFileList({ files: restored, type: 'addFiles' });
        }
      } catch {
        antdMessage.error(t('inputQueue.serverMutationFailed'));
      } finally {
        setPendingIds((ids) => {
          const next = new Set(ids);
          next.delete(msg.id);
          return next;
        });
      }
    },
    [
      context,
      contextKey,
      dispatchChatUploadFileList,
      editor,
      pendingIds,
      removeGatewayQueuedMessage,
      removeQueuedMessage,
      t,
    ],
  );

  const handleDelete = useCallback(
    async (msg: QueuedMessage) => {
      if (pendingIds.has(msg.id)) return;
      if (msg.source !== 'gateway') {
        removeQueuedMessage(contextKey, msg.id);
        return;
      }

      setPendingIds((ids) => new Set(ids).add(msg.id));
      try {
        await removeGatewayQueuedMessage(context, msg.id);
      } catch {
        antdMessage.error(t('inputQueue.serverMutationFailed'));
      } finally {
        setPendingIds((ids) => {
          const next = new Set(ids);
          next.delete(msg.id);
          return next;
        });
      }
    },
    [context, contextKey, pendingIds, removeGatewayQueuedMessage, removeQueuedMessage, t],
  );

  // "Send now": cancel the currently running agent run for this context, then
  // immediately fire a fresh sendMessage with this queued item's payload. The
  // remaining queue (if any) stays in place — the new turn's onComplete drain
  // will pick them up after it finishes. Reads chatStore inline so we don't
  // re-subscribe the whole tray to the operations map.
  const handleSendNow = useCallback(
    (msg: QueuedMessage) => {
      const chat = useChatStore.getState();
      // Cancel EVERY running blocker the item could be queued behind, not just the
      // first: matching one op would miss an interim blocker or the second of the
      // two concurrent `regenerate` ops a delAndRegenerate/delAndResendThread
      // retry runs (outer wrapper + inner regenerateUserMessage). Leaving any
      // blocker running would make the sendMessage below re-enqueue the item, so
      // "Send now" becomes a no-op. The selector shares the queue-blocking
      // predicate with the enqueue check.
      const runningOpIds = operationSelectors.getRunningQueueBlockingOperationIds(context)(chat);
      for (const id of runningOpIds) chat.cancelOperation(id, 'send_now');
      removeQueuedMessage(contextKey, msg.id);

      // Reconstruct UploadFileItem-shaped objects so the optimistic temp message
      // can rebuild imageList/videoList from the snapshotted preview metadata.
      const filesArray = msg.filesPreview?.length
        ? reconstructUploadFilesFromQueue(msg.filesPreview)
        : msg.files?.length
          ? (msg.files.map((id) => ({ id })) as any)
          : undefined;
      chat
        .sendMessage({
          context,
          editorData: msg.editorData,
          files: filesArray,
          message: msg.content,
        })
        .catch((e: unknown) => {
          console.error('[QueueTray] sendNow failed:', e);
        });
    },
    [context, contextKey, removeQueuedMessage],
  );

  if (queuedMessages.length === 0) return null;

  return (
    <Flexbox className={styles.container} gap={0}>
      {queuedMessages.map((msg, index) => {
        const previews = msg.filesPreview ?? [];
        const pending = pendingIds.has(msg.id);
        return (
          <Flexbox
            horizontal
            align="center"
            className={index > 0 ? `${styles.item} ${styles.itemDivider}` : styles.item}
            gap={8}
            key={msg.id}
          >
            <Icon className={styles.icon} icon={ListEnd} size={14} />
            <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ overflow: 'hidden' }}>
              {previews.length > 0 && (
                <Flexbox horizontal flex={'none'} gap={4}>
                  {previews.map((file) => (
                    <QueuedFilePreview file={file} key={file.id} />
                  ))}
                </Flexbox>
              )}
              {msg.content && (
                <Flexbox className={styles.text} flex={1}>
                  {msg.content}
                </Flexbox>
              )}
            </Flexbox>
            <ActionIcon
              disabled={pending}
              icon={Pencil}
              loading={pending}
              size="small"
              title={t('inputQueue.edit')}
              onClick={() => void handleEdit(msg)}
            />
            {msg.source !== 'gateway' && (
              <ActionIcon
                disabled={pending}
                icon={ArrowUp}
                size="small"
                title={t('inputQueue.sendNow')}
                onClick={() => handleSendNow(msg)}
              />
            )}
            <ActionIcon
              disabled={pending}
              icon={Trash2}
              loading={pending}
              size="small"
              title={t('inputQueue.delete')}
              onClick={() => void handleDelete(msg)}
            />
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

QueueTray.displayName = 'QueueTray';

export default QueueTray;
