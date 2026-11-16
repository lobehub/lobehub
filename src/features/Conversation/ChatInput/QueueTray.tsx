'use client';

import { ActionIcon, createStaticStyles, Flexbox, Icon, Image, toast, Tooltip } from '@lobehub/ui';
import { ArrowUp, Info, ListEnd, Pencil, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { useSingleton } from '@/hooks/useSingleton';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import {
  isServerDeliveringQueuedMessage,
  type QueuedFile,
  type QueuedMessage,
  reconstructUploadFilesFromQueue,
} from '@/store/chat/slices/operation/types';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useFileStore } from '@/store/file';

import { useConversationResourceAccess } from '../hooks/useConversationResourceAccess';
import { useConversationStore } from '../store';
import {
  createQueueSendNowGate,
  getQueuedHintKey,
  putQueuedMessageInEditor,
  sendQueuedMessageNow,
} from './utils';

const PREVIEW_SIZE = 28;

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    container-type: inline-size;

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
  hint: css`
    display: inline-flex;
    flex: none;
    gap: 4px;
    align-items: center;

    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  hintGlyph: css`
    cursor: help;

    display: none;

    padding: 0;
    border: none;
    border-radius: 4px;

    color: inherit;

    background: none;

    /* Too narrow to spare a sentence on the send timing: keep the meaning on the
       glyph's tooltip instead of squeezing the message text. */
    @container (max-width: 480px) {
      display: inline-flex;
    }
  `,
  hintText: css`
    white-space: nowrap;

    @container (max-width: 480px) {
      display: none;
    }
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
    padding-block: 6px;
    padding-inline: 12px 8px;
  `,
  itemDivider: css`
    border-block-start: 1px solid ${cssVar.colorFillTertiary};
  `,
  text: css`
    overflow: hidden;

    min-width: 0;

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
  const { canUseResource } = useConversationResourceAccess();
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
  const waitsForRunEnd = useChatStore(operationSelectors.isQueueDrainedAtRunEnd(context));
  const withdrawQueuedMessage = useChatStore((s) => s.withdrawQueuedMessage);
  const dispatchChatUploadFileList = useFileStore((s) => s.dispatchChatUploadFileList);
  const editor = useConversationStore((s) => s.editor);
  const sendNowGate = useSingleton(createQueueSendNowGate);

  // Edit: restore both the text content AND the attached files back to the
  // input area, so the user can tweak the message and re-send. Without the
  // file restore, images attached to a queued message would silently disappear
  // when the user clicks the pencil.
  // A follow-up queued on the server may already be on its way into the run;
  // then it is neither edited nor sent again.
  // Still in the tray: a run took it and the agent has not read it yet.
  // Gone: it already landed in the conversation.
  const toastAlreadyDelivered = useCallback(
    (id: string) => {
      const pending = useChatStore
        .getState()
        .queuedMessages[contextKey]?.find((queued) => queued.id === id);
      toast.info(
        t(
          pending && isServerDeliveringQueuedMessage(pending)
            ? 'inputQueue.alreadyDelivering'
            : 'inputQueue.alreadyDelivered',
        ),
      );
    },
    [contextKey, t],
  );

  const withdraw = useCallback(
    async (msg: QueuedMessage) => {
      const withdrawn = await withdrawQueuedMessage(contextKey, msg.id).catch((error) => {
        console.error('[QueueTray] withdrawing a queued message failed:', error);
        toast.error(t('inputQueue.withdrawFailed'));
        return undefined;
      });
      if (withdrawn === false) toastAlreadyDelivered(msg.id);
      return !!withdrawn;
    },
    [contextKey, toastAlreadyDelivered, withdrawQueuedMessage],
  );

  const handleEdit = useCallback(
    async (msg: QueuedMessage) => {
      if (!(await withdraw(msg))) return;
      if (editor) putQueuedMessageInEditor(editor, msg);
      editor?.focus();
      if (msg.filesPreview?.length) {
        const restored = reconstructUploadFilesFromQueue(msg.filesPreview);
        dispatchChatUploadFileList(contextKey, { files: restored, type: 'addFiles' });
      }
    },
    [contextKey, dispatchChatUploadFileList, editor, withdraw],
  );

  // "Send now": cancel the currently running agent run for this context, then
  // immediately fire a fresh sendMessage with this queued item's payload. The
  // remaining queue (if any) stays in place — the new turn's onComplete drain
  // will pick them up after it finishes. Reads chatStore inline so we don't
  // re-subscribe the whole tray to the operations map.
  // The row shows it is on its way at once: stopping a CLI agent waits for the
  // device to confirm, which can take seconds.
  const [sendingId, setSendingId] = useState<string>();
  const handleSendNow = useCallback(
    async (msg: QueuedMessage) => {
      await sendNowGate
        .run(async () => {
          setSendingId(msg.id);
          try {
            const outcome = await sendQueuedMessageNow({
              chat: useChatStore.getState(),
              context,
              contextKey,
              isQueued: (id) =>
                !!useChatStore.getState().queuedMessages[contextKey]?.some((q) => q.id === id),
              msg,
              withdraw: (queued) => withdrawQueuedMessage(contextKey, queued.id),
            });
            if (outcome === 'delivered') toastAlreadyDelivered(msg.id);
          } finally {
            setSendingId(undefined);
          }
        })
        .catch((error) => {
          console.error('[QueueTray] sendNow failed:', error);
          toast.error(t('inputQueue.sendNowFailed'));
        });
    },
    [context, contextKey, sendNowGate, t, toastAlreadyDelivered, withdrawQueuedMessage],
  );

  if (queuedMessages.length === 0) return null;
  // Defense-in-depth: normally a view-only member can't enqueue at all, but a
  // mid-session access downgrade could leave items behind — never offer
  // "send now" then.
  if (!canUseResource) return null;

  // The queue drains as one take-all and is merged into a single send, so a
  // multi-item queue has to say "merges" instead of "sends". A heterogeneous
  // CLI run only drains once the whole run ends, not after the current step.
  // One a run already took is no longer part of that merge: it says where it
  // is instead and offers nothing to do with it.
  const waitingCount = queuedMessages.filter((msg) => !isServerDeliveringQueuedMessage(msg)).length;
  const hintText = t(getQueuedHintKey({ count: waitingCount, waitsForRunEnd }));

  return (
    <Flexbox className={styles.container} gap={0}>
      {queuedMessages.map((msg, index) => {
        const previews = msg.filesPreview ?? [];
        // A "send now" in progress keeps its row as is: it is interrupting the
        // run to take this message back, and shows that with its spinner.
        const delivering = isServerDeliveringQueuedMessage(msg) && sendingId !== msg.id;
        const rowHint = delivering ? t('inputQueue.deliveringHint') : hintText;
        return (
          <Flexbox
            horizontal
            align="center"
            className={index > 0 ? `${styles.item} ${styles.itemDivider}` : styles.item}
            gap={8}
            key={msg.id}
          >
            <Icon className={styles.icon} icon={ListEnd} size={14} />
            <Flexbox
              horizontal
              align={'center'}
              flex={'0 1 auto'}
              gap={8}
              style={{ minWidth: 0, overflow: 'hidden' }}
            >
              {previews.length > 0 && (
                <Flexbox horizontal flex={'none'} gap={4}>
                  {previews.map((file) => (
                    <QueuedFilePreview file={file} key={file.id} />
                  ))}
                </Flexbox>
              )}
              {msg.content && (
                <Flexbox className={styles.text} flex={'0 1 auto'}>
                  {msg.content}
                </Flexbox>
              )}
            </Flexbox>
            {/* The send timing is this message's own caption, so it rides the
                message row right after the content instead of taking a line.
                Several queued messages are merged into a single send on drain,
                so the wording changes with the queue size. */}
            <span className={styles.hint}>
              {/* Collapsed form. It is display:none while the sentence fits, so
                  it adds no tab stop there; when it shows it is a real
                  focusable control carrying the wording as its name. */}
              <Tooltip title={rowHint}>
                <button aria-label={rowHint} className={styles.hintGlyph} type={'button'}>
                  <Icon icon={Info} size={13} />
                </button>
              </Tooltip>
              <span className={styles.hintText}>{rowHint}</span>
            </span>
            <div style={{ flex: 1 }} />
            {!delivering && (
              <>
                <ActionIcon
                  aria-label={t('inputQueue.edit')}
                  disabled={sendingId === msg.id}
                  icon={Pencil}
                  size="small"
                  title={t('inputQueue.edit')}
                  onClick={() => handleEdit(msg)}
                />
                <ActionIcon
                  aria-label={t('inputQueue.sendNow')}
                  disabled={!!sendingId}
                  icon={ArrowUp}
                  loading={sendingId === msg.id}
                  size="small"
                  title={t('inputQueue.sendNow')}
                  onClick={() => handleSendNow(msg)}
                />
                <ActionIcon
                  aria-label={t('inputQueue.delete')}
                  disabled={sendingId === msg.id}
                  icon={Trash2}
                  size="small"
                  title={t('inputQueue.delete')}
                  onClick={() => withdraw(msg)}
                />
              </>
            )}
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

QueueTray.displayName = 'QueueTray';

export default QueueTray;
