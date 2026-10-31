'use client';

import { ActionIcon, Flexbox, Icon, Image, toast, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowUp, Info, ListEnd, Pencil, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';
import { useSingleton } from '@/hooks/useSingleton';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import {
  type QueuedFile,
  type QueuedMessage,
  reconstructUploadFilesFromQueue,
} from '@/store/chat/slices/operation/types';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { useFileStore } from '@/store/file';

import { useConversationResourceAccess } from '../hooks/useConversationResourceAccess';
import { useConversationStore } from '../store';
import thumbStyles from './QueueTray.module.css';
import {
  createQueueSendNowGate,
  getQueuedHintKey,
  putQueuedMessageInEditor,
  sendQueuedMessageNow,
} from './utils';

const PREVIEW_SIZE = 28;

const NARROW = '@container (max-width: 480px)';

const styles = stylex.create({
  container: {
    containerType: 'inline-size',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorFillSecondary,
    borderBlockEndWidth: 0,
    borderStartStartRadius: '12px',
    borderStartEndRadius: '12px',
    borderEndStartRadius: 0,
    borderEndEndRadius: 0,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  fileChip: {
    overflow: 'hidden',
    flexShrink: 0,
    maxWidth: '160px',
    height: '28px',
    paddingBlock: 0,
    paddingInline: '6px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorFillTertiary,
    borderRadius: '6px',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
  },
  fileChipName: { overflow: 'hidden', textOverflow: 'ellipsis' },
  hint: {
    display: 'inline-flex',
    flex: 'none',
    gap: '4px',
    alignItems: 'center',
    fontSize: '12px',
    color: cssVar.colorTextDescription,
  },
  // Too narrow to spare a sentence on the send timing: keep the meaning on the
  // glyph's tooltip instead of squeezing the message text.
  hintGlyph: {
    cursor: 'help',
    display: { default: 'none', [NARROW]: 'inline-flex' },
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    borderRadius: '4px',
    color: 'inherit',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
  hintText: {
    whiteSpace: 'nowrap',
    display: { default: null, [NARROW]: 'none' },
  },
  icon: { flexShrink: 0, color: cssVar.colorTextDescription },
  item: {
    paddingBlock: '6px',
    paddingInlineStart: '12px',
    paddingInlineEnd: '8px',
  },
  itemDivider: {
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorFillTertiary,
  },
  text: {
    overflow: 'hidden',
    minWidth: 0,
    fontSize: '13px',
    lineHeight: 1.4,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

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
        classNames={{ wrapper: thumbStyles.imageThumb }}
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
    <Flexbox
      horizontal
      align={'center'}
      {...stylex.props(styles.fileChip)}
      gap={4}
      title={file.name}
    >
      <FileIcon fileName={file.name} fileType={file.mimeType} size={14} />
      <span {...stylex.props(styles.fileChipName)}>{file.name}</span>
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
  const withdraw = useCallback(
    async (msg: QueuedMessage) => {
      const withdrawn = await withdrawQueuedMessage(contextKey, msg.id).catch((error) => {
        console.error('[QueueTray] withdrawing a queued message failed:', error);
        toast.error(t('inputQueue.withdrawFailed'));
        return undefined;
      });
      if (withdrawn === false) toast.info(t('inputQueue.alreadyDelivered'));
      return !!withdrawn;
    },
    [contextKey, t, withdrawQueuedMessage],
  );

  const handleEdit = useCallback(
    async (msg: QueuedMessage) => {
      if (!(await withdraw(msg))) return;
      if (editor) putQueuedMessageInEditor(editor, msg);
      editor?.focus();
      if (msg.filesPreview?.length) {
        const restored = reconstructUploadFilesFromQueue(msg.filesPreview);
        dispatchChatUploadFileList({ files: restored, type: 'addFiles' });
      }
    },
    [dispatchChatUploadFileList, editor, withdraw],
  );

  // "Send now": cancel the currently running agent run for this context, then
  // immediately fire a fresh sendMessage with this queued item's payload. The
  // remaining queue (if any) stays in place — the new turn's onComplete drain
  // will pick them up after it finishes. Reads chatStore inline so we don't
  // re-subscribe the whole tray to the operations map.
  const handleSendNow = useCallback(
    async (msg: QueuedMessage) => {
      await sendNowGate
        .run(() =>
          sendQueuedMessageNow({
            chat: useChatStore.getState(),
            context,
            contextKey,
            msg,
            withdraw,
          }),
        )
        .catch((error) => console.error('[QueueTray] sendNow failed:', error));
    },
    [context, contextKey, sendNowGate, withdraw],
  );

  if (queuedMessages.length === 0) return null;
  // Defense-in-depth: normally a view-only member can't enqueue at all, but a
  // mid-session access downgrade could leave items behind — never offer
  // "send now" then.
  if (!canUseResource) return null;

  // The queue drains as one take-all and is merged into a single send, so a
  // multi-item queue has to say "merges" instead of "sends". A heterogeneous
  // CLI run only drains once the whole run ends, not after the current step.
  const hintText = t(getQueuedHintKey({ count: queuedMessages.length, waitsForRunEnd }));

  return (
    <Flexbox {...stylex.props(styles.container)} gap={0}>
      {queuedMessages.map((msg, index) => {
        const previews = msg.filesPreview ?? [];
        return (
          <Flexbox
            horizontal
            align="center"
            {...stylex.props(styles.item, index > 0 && styles.itemDivider)}
            gap={8}
            key={msg.id}
          >
            <Icon {...stylex.props(styles.icon)} icon={ListEnd} size={14} />
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
                <Flexbox {...stylex.props(styles.text)} flex={'0 1 auto'}>
                  {msg.content}
                </Flexbox>
              )}
            </Flexbox>
            {/* The send timing is this message's own caption, so it rides the
                message row right after the content instead of taking a line.
                Several queued messages are merged into a single send on drain,
                so the wording changes with the queue size. */}
            <span {...stylex.props(styles.hint)}>
              {/* Collapsed form. It is display:none while the sentence fits, so
                  it adds no tab stop there; when it shows it is a real
                  focusable control carrying the wording as its name. */}
              <Tooltip title={hintText}>
                <button aria-label={hintText} {...stylex.props(styles.hintGlyph)} type={'button'}>
                  <Icon icon={Info} size={13} />
                </button>
              </Tooltip>
              <span {...stylex.props(styles.hintText)}>{hintText}</span>
            </span>
            <div style={{ flex: 1 }} />
            <ActionIcon
              aria-label={t('inputQueue.edit')}
              icon={Pencil}
              size="small"
              title={t('inputQueue.edit')}
              onClick={() => handleEdit(msg)}
            />
            <ActionIcon
              aria-label={t('inputQueue.sendNow')}
              icon={ArrowUp}
              size="small"
              title={t('inputQueue.sendNow')}
              onClick={() => handleSendNow(msg)}
            />
            <ActionIcon
              aria-label={t('inputQueue.delete')}
              icon={Trash2}
              size="small"
              title={t('inputQueue.delete')}
              onClick={() => withdraw(msg)}
            />
          </Flexbox>
        );
      })}
    </Flexbox>
  );
});

QueueTray.displayName = 'QueueTray';

export default QueueTray;
