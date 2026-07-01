'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { Forward, Trash2, X } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { messageStateSelectors, useConversationStore } from '../store';
import ForwardModal from './ForwardModal';

const styles = createStaticStyles(({ css }) => ({
  // Full-width bar docked at the bottom in place of the composer (hidden by
  // MessageForwardFooter while selecting). Count on the leading edge, actions on
  // the trailing edge.
  bar: css`
    position: relative;

    inline-size: 100%;
    padding-block: 12px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgContainer};
  `,
  // Pinned to the side so the actions stay centered regardless of the count.
  count: css`
    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 16px;
    transform: translateY(-50%);
  `,
}));

/**
 * Bottom action bar shown while multi-selecting: selection count on the leading
 * edge, Cancel / Delete / Forward on the trailing edge. Replaces the chat
 * composer (hidden by MessageForwardFooter).
 */
const SelectionFooterBar = memo(() => {
  const { t } = useTranslation('chat');
  const { message } = App.useApp();
  const [forwardOpen, setForwardOpen] = useState(false);
  const selectedCount = useConversationStore(messageStateSelectors.selectedMessageCount);
  const selectedMessageIds = useConversationStore((s) => s.selectedMessageIds);
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
        message.success(t('messageForward.deleteConfirm.success', { count: selectedCount }));
      },
      title: t('messageForward.deleteConfirm.title'),
    });
  };

  return (
    <>
      <Flexbox horizontal align={'center'} className={styles.bar} justify={'center'}>
        <Text className={styles.count} type={'secondary'}>
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
            onClick={() => setForwardOpen(true)}
          >
            {t('messageForward.bar.forward')}
          </Button>
        </Flexbox>
      </Flexbox>
      <ForwardModal open={forwardOpen} onClose={() => setForwardOpen(false)} />
    </>
  );
});

SelectionFooterBar.displayName = 'MessageForwardSelectionFooterBar';

export default SelectionFooterBar;
