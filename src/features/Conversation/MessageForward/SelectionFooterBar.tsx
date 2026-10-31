'use client';

import { Button, confirmModal, Flexbox, Icon, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Forward, Trash2, X } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { messageStateSelectors, useConversationStore, useConversationStoreApi } from '../store';
import { openForwardModal } from './ForwardModal';

const styles = stylex.create({
  bar: {
    position: 'relative',
    inlineSize: '100%',
    paddingBlock: '12px',
    paddingInline: '16px',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  count: {
    position: 'absolute',
    insetBlockStart: '50%',
    insetInlineStart: '16px',
    transform: 'translateY(-50%)',
  },
});

/**
 * Bottom action bar shown while multi-selecting: selection count on the leading
 * edge, Cancel / Delete / Forward on the trailing edge. Replaces the chat
 * composer (hidden by MessageForwardFooter).
 */
const SelectionFooterBar = memo(() => {
  const { t } = useTranslation('chat');

  const [forwardOpen, setForwardOpen] = useState(false);
  const storeApi = useConversationStoreApi();
  const selectedCount = useConversationStore(messageStateSelectors.selectedMessageCount);
  const selectedMessageIds = useConversationStore(
    messageStateSelectors.selectedDeletableMessageIds,
  );
  const exitSelectionMode = useConversationStore((s) => s.exitSelectionMode);
  const deleteMessages = useConversationStore((s) => s.deleteMessages);

  const disabled = selectedCount === 0;

  // Esc exits selection mode. When the forward dialog is open, its own Esc
  // handler closes it first — skip so a single Esc doesn't do both.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || forwardOpen) return;
      exitSelectionMode();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [forwardOpen, exitSelectionMode]);

  const handleDelete = () => {
    confirmModal({
      cancelText: t('cancel', { ns: 'common' }),
      content: t('messageForward.deleteConfirm.desc', { count: selectedCount }),
      okButtonProps: { danger: true },
      okText: t('delete', { ns: 'common' }),
      onOk: async () => {
        await deleteMessages([...selectedMessageIds]);
        exitSelectionMode();
        toast.success(t('messageForward.deleteConfirm.success', { count: selectedCount }));
      },
      title: t('messageForward.deleteConfirm.title'),
    });
  };

  const handleForward = () => {
    setForwardOpen(true);
    openForwardModal({
      createConversationStore: () => storeApi,
      onClosed: () => setForwardOpen(false),
    });
  };

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.bar).className}
      justify={'center'}
    >
      <Text className={stylex.props(styles.count).className} type={'secondary'}>
        {t('messageForward.bar.selected', { count: selectedCount })}
      </Text>
      <Flexbox horizontal align={'center'} gap={4}>
        <Button icon={<Icon icon={X} />} type={'text'} onClick={exitSelectionMode}>
          {t('messageForward.bar.cancel')}
        </Button>
        <Button
          danger
          disabled={disabled}
          icon={<Icon icon={Trash2} />}
          type={'text'}
          onClick={handleDelete}
        >
          {t('messageForward.bar.delete')}
        </Button>
        <Button
          disabled={disabled}
          icon={<Icon icon={Forward} />}
          type={'text'}
          onClick={handleForward}
        >
          {t('messageForward.bar.forward')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

SelectionFooterBar.displayName = 'MessageForwardSelectionFooterBar';

export default SelectionFooterBar;
