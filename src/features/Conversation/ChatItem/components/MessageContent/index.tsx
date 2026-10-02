import { Flexbox } from '@lobehub/ui';
import { type ModalInstance } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { type ReactNode } from 'react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { dataSelectors, useConversationStore } from '@/features/Conversation/store';
import { openEditorModal } from '@/features/EditorModal';
import { usePermission } from '@/hooks/usePermission';

import { type ChatItemProps } from '../../type';
import { useEditConfirmation } from './useEditConfirmation';

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
    const toggleMessageEditing = useConversationStore((s) => s.toggleMessageEditing);

    const editorData = useConversationStore(
      (s) => dataSelectors.getDisplayMessageById(id)(s)?.editorData,
    );

    const { t } = useTranslation('common');
    const { allowed: canCreate } = usePermission('create_content');
    const { allowed: canEdit } = usePermission('edit_own_content');

    const onEditingChange = useCallback(
      (edit: boolean) => {
        if (!canEdit && edit) return;
        toggleMessageEditing(id, edit);
      },
      [canEdit, id, toggleMessageEditing],
    );

    const { onConfirm, shouldSendOnConfirm } = useEditConfirmation({
      canCreate,
      canEdit,
      editing,
      id,
      onEditingChange,
    });

    // Held in a ref rather than in the effect's deps: the editor snapshots the
    // message when it opens, so a re-render (a streaming token, a permission
    // refresh) must not tear down and reopen a modal the user is typing in.
    const openEditorRef = useRef<() => ModalInstance>(undefined);
    openEditorRef.current = () =>
      openEditorModal({
        editorData,
        okText: shouldSendOnConfirm ? t('send') : t('save'),
        value: message ? String(message) : '',
        onClose: () => onEditingChange(false),
        onConfirm: (value, data) => onConfirm(value, data as Record<string, unknown> | undefined),
      });

    useEffect(() => {
      if (!editing) return;
      const instance = openEditorRef.current!();
      return () => instance.close();
    }, [editing]);

    return (
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
    );
  },
);

export default MessageContent;
