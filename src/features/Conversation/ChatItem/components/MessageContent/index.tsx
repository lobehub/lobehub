import { Flexbox, type ModalInstance } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { type ReactNode } from 'react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrintMode } from '@/features/Conversation/components/PrintModeContext';
import { dataSelectors, useConversationStore } from '@/features/Conversation/store';
import { openEditorModal } from '@/features/EditorModal';
import { usePermission } from '@/hooks/usePermission';
import { sx } from '@/styles/sx';

import { type ChatItemProps } from '../../type';
import { useEditConfirmation } from './useEditConfirmation';

export const MSG_CONTENT_CLASSNAME = 'msg_content_flag';

const styles = stylex.create({
  bubble: {
    paddingBlock: '8px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillTertiary,
  },
  disabled: {
    userSelect: 'none',
    color: cssVar.colorTextSecondary,
  },
  message: {
    position: 'relative',
    overflow: 'hidden',
    maxWidth: '100%',
  },
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
    const printMode = usePrintMode();

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

    const { notice, onConfirm, shouldSendOnConfirm } = useEditConfirmation({
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
        notice,
        okText: shouldSendOnConfirm ? t('send') : t('save'),
        value: message ? String(message) : '',
        onClose: () => onEditingChange(false),
        onConfirm: (value, data) => onConfirm(value, data as Record<string, unknown> | undefined),
      });

    useEffect(() => {
      // The print copy renders this component too; opening a second editor for it
      // would close the real one (and drop its draft) when printing ends.
      if (!editing || printMode) return;
      const instance = openEditorRef.current!();
      return () => instance.close();
    }, [editing, printMode]);

    return (
      <Flexbox
        gap={16}
        {...sx(
          [styles.message, variant === 'bubble' && styles.bubble, disabled && styles.disabled],
          [MSG_CONTENT_CLASSNAME, className].filter(Boolean).join(' '),
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
