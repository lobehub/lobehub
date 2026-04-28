import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { type ReactNode } from 'react';
import { memo, Suspense, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import {
  dataSelectors,
  messageStateSelectors,
  useConversationStore,
} from '@/features/Conversation/store';
import dynamic from '@/libs/next/dynamic';

import { type ChatItemProps } from '../../type';

const EditorModal = dynamic(
  () => import('@/features/EditorModal').then((mode) => mode.EditorModal),
  { ssr: false },
);

export const MSG_CONTENT_CLASSNAME = 'msg_content_flag';

export const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    bubble: css`
      padding-block: 8px;
      padding-inline: 12px;
      border-radius: ${cssVar.borderRadiusLG};
      background-color: ${cssVar.colorFillTertiary};
    `,
    disabled: css`
      user-select: ${'none'};
      color: ${cssVar.colorTextSecondary};
    `,
    message: css`
      position: relative;
      overflow: hidden;
      max-width: 100%;
    `,
  };
});

export interface MessageContentProps {
  children?: ReactNode;
  className?: string;
  disabled?: ChatItemProps['disabled'];
  editing?: ChatItemProps['editing'];
  id: string;
  message?: ReactNode;
  messageExtra?: ChatItemProps['messageExtra'];
  onDoubleClick?: ChatItemProps['onDoubleClick'];
  variant?: 'bubble' | 'default';
}

const MessageContent = memo<MessageContentProps>(
  ({
    editing,
    id,
    message,
    messageExtra,
    children,
    onDoubleClick,
    disabled,
    className,
    variant,
  }) => {
    const [toggleMessageEditing, updateMessageContent, regenerateUserMessage] =
      useConversationStore((s) => [
        s.toggleMessageEditing,
        s.updateMessageContent,
        s.regenerateUserMessage,
      ]);

    const editorData = useConversationStore(
      (s) => dataSelectors.getDisplayMessageById(id)(s)?.editorData,
    );

    // Short-circuit on non-editing rows so streaming token updates stay O(1) per row
    // instead of each row running `findLast` on displayMessages (O(N²) per update).
    // Use isInputLoading (covers sendMessage + AI runtime) rather than isAIGenerating,
    // otherwise the initial send phase — where the persisted id has just swapped in
    // under an optimistic tmp_* op — would flip to Send and kick off a duplicate
    // regenerate for the same prompt.
    const shouldSendOnConfirm = useConversationStore((s) => {
      if (!editing) return false;
      if (dataSelectors.getDisplayMessageById(id)(s)?.role !== 'user') return false;
      if (s.displayMessages.findLast((m) => m.role === 'user')?.id !== id) return false;
      return !messageStateSelectors.isInputLoading(s);
    });

    const { t } = useTranslation('common');

    const onEditingChange = useCallback(
      (edit: boolean) => toggleMessageEditing(id, edit),
      [id, toggleMessageEditing],
    );

    return (
      <>
        <Flexbox
          gap={16}
          className={cx(
            MSG_CONTENT_CLASSNAME,
            styles.message,
            variant === 'bubble' && styles.bubble,
            disabled && styles.disabled,
            className,
          )}
          onDoubleClick={onDoubleClick}
        >
          {children || message}
          {messageExtra}
        </Flexbox>
        <Suspense fallback={null}>
          {editing && (
            <EditorModal
              editorData={editorData}
              okText={shouldSendOnConfirm ? t('send') : t('save')}
              open={editing}
              value={message ? String(message) : ''}
              onCancel={() => onEditingChange(false)}
              onConfirm={async (value, newEditorData) => {
                onEditingChange(false);
                // updateMessageContent does an optimistic state update synchronously before
                // awaiting the DB round trip. Kick off regenerate in parallel so the old
                // assistant reply is replaced by switchMessageBranch without waiting for persistence.
                const save = updateMessageContent(id, value, {
                  editorData: newEditorData as Record<string, any> | undefined,
                });
                if (shouldSendOnConfirm) {
                  await regenerateUserMessage(id);
                }
                await save;
              }}
            />
          )}
        </Suspense>
      </>
    );
  },
);

export default MessageContent;
