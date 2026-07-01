'use client';

import { Block, Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { Button, confirmModal } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { Forward, Trash2, X } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { messageStateSelectors, useConversationStore } from '../store';
import ForwardPopover from './ForwardPopover';

const styles = createStaticStyles(({ css }) => ({
  // Zero-height anchor at the bottom of the conversation column. The composer is
  // hidden while selecting, so the pill floats over the last turns instead of
  // reserving a full-height bar.
  anchor: css`
    position: relative;
  `,
  float: css`
    pointer-events: none;

    position: absolute;
    z-index: 10;
    inset-block-end: 0;
    inset-inline: 0;
  `,
  // Floating pill, mirroring the share page's bottom action bar: content-width
  // and comfortably tall rather than a wide thin strip.
  pill: css`
    pointer-events: auto;

    max-inline-size: calc(100% - 32px);
    border-radius: 9999px;

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
}));

/**
 * Floating pill action bar shown while multi-selecting: selection count on the
 * leading edge, Cancel / Delete / Forward on the trailing edge. Replaces the
 * chat composer (hidden by MessageForwardFooter) and floats over the bottom of
 * the conversation, matching the /share/t/<slug> action bar.
 */
const SelectionFloatBar = memo(() => {
  const { t } = useTranslation('chat');
  const { message } = App.useApp();
  const [forwardOpen, setForwardOpen] = useState(false);
  const selectedCount = useConversationStore(messageStateSelectors.selectedMessageCount);
  const selectedMessageIds = useConversationStore((s) => s.selectedMessageIds);
  const exitSelectionMode = useConversationStore((s) => s.exitSelectionMode);
  const deleteMessages = useConversationStore((s) => s.deleteMessages);

  const disabled = selectedCount === 0;

  // Esc exits selection mode. When the forward popover is open, its own Esc
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
    <div className={styles.anchor}>
      <Center className={styles.float} paddingBlock={16}>
        <Block
          horizontal
          align={'center'}
          className={styles.pill}
          gap={16}
          paddingBlock={8}
          paddingInline={'20px 8px'}
          variant={'outlined'}
        >
          <Text type={'secondary'}>
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
            <ForwardPopover disabled={disabled} open={forwardOpen} onOpenChange={setForwardOpen}>
              <Button
                disabled={disabled}
                icon={<Icon icon={Forward} />}
                shape={'round'}
                type={'primary'}
              >
                {t('messageForward.bar.forward')}
              </Button>
            </ForwardPopover>
          </Flexbox>
        </Block>
      </Center>
    </div>
  );
});

SelectionFloatBar.displayName = 'MessageForwardSelectionFloatBar';

export default SelectionFloatBar;
