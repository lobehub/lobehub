'use client';

import { ActionIcon, Flexbox, Icon, Image } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ArrowUp, ListEnd, Pencil, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import {
  AI_RUNTIME_OPERATION_TYPES,
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
    border: 1px solid ${cssVar.colorBorderSecondary};
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
    border: 1px solid ${cssVar.colorBorderSecondary};
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
  const dispatchChatUploadFileList = useFileStore((s) => s.dispatchChatUploadFileList);
  const editor = useConversationStore((s) => s.editor);

  // Edit: restore both the text content AND the attached files back to the
  // input area, so the user can tweak the message and re-send. Without the
  // file restore, images attached to a queued message would silently disappear
  // when the user clicks the pencil.
  const handleEdit = useCallback(
    (msg: QueuedMessage) => {
      removeQueuedMessage(contextKey, msg.id);
      editor?.setDocument('markdown', msg.content);
      editor?.focus();
      if (msg.filesPreview?.length) {
        const restored = reconstructUploadFilesFromQueue(msg.filesPreview);
        dispatchChatUploadFileList({ files: restored, type: 'addFiles' });
      }
    },
    [contextKey, dispatchChatUploadFileList, editor, removeQueuedMessage],
  );

  // "Send now": cancel the currently running agent run for this context, then
  // immediately fire a fresh sendMessage with this queued item's payload. The
  // remaining queue (if any) stays in place — the new turn's onComplete drain
  // will pick them up after it finishes. Reads chatStore inline so we don't
  // re-subscribe the whole tray to the operations map.
  const handleSendNow = useCallback(
    (msg: QueuedMessage) => {
      const chat = useChatStore.getState();
      const runningOpId = chat.operationsByContext[contextKey]?.find((id) => {
        const op = chat.operations[id];
        return op && AI_RUNTIME_OPERATION_TYPES.includes(op.type) && op.status === 'running';
      });
      if (runningOpId) chat.cancelOperation(runningOpId, 'send_now');
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
              icon={Pencil}
              size="small"
              title={t('inputQueue.edit')}
              onClick={() => handleEdit(msg)}
            />
            <ActionIcon
              icon={ArrowUp}
              size="small"
              title={t('inputQueue.sendNow')}
              onClick={() => handleSendNow(msg)}
            />
            <ActionIcon
              icon={Trash2}
              size="small"
              title={t('inputQueue.delete')}
              onClick={() => removeQueuedMessage(contextKey, msg.id)}
            />
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

QueueTray.displayName = 'QueueTray';

export default QueueTray;
