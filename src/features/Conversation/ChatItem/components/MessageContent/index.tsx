import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { type ReactNode } from 'react';
import { memo, Suspense, useCallback } from 'react';

import { useConversationStore } from '@/features/Conversation/store';
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
    const [toggleMessageEditing, updateMessageContent] = useConversationStore((s) => [
      s.toggleMessageEditing,
      s.updateMessageContent,
    ]);

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
              open={editing}
              value={message ? String(message) : ''}
              onCancel={() => onEditingChange(false)}
              onConfirm={async (value) => {
                await updateMessageContent(id, value);
                onEditingChange(false);
              }}
            />
          )}
        </Suspense>
      </>
    );
  },
);

export default MessageContent;
