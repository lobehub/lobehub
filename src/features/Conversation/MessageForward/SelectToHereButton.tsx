'use client';

import { Button, Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowDownToLine } from 'lucide-react';
import { memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { messageStateSelectors, useConversationStore } from '../store';

const styles = stylex.create({
  button: {
    pointerEvents: 'auto',
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    boxShadow: cssVar.boxShadowSecondary,
  },
  line: {
    flex: '1',
    blockSize: '0',
    borderBlockStartWidth: '1px',
    borderBlockStartStyle: 'dashed',
    borderBlockStartColor: cssVar.colorBorder,
  },
  wrap: {
    pointerEvents: 'none',
    position: 'absolute',
    zIndex: 20,
    insetBlockStart: '75%',
    insetInline: '0',
    transform: 'translateY(-50%)',
  },
});

/**
 * "Select to here" marker shown while multi-selecting: a dashed line across the
 * chat area near the bottom, with a button that selects every message from the
 * top of the conversation down to the line. Renders nothing outside selection
 * mode.
 */
const SelectToHereButton = memo(() => {
  const { t } = useTranslation('chat');
  const wrapRef = useRef<HTMLDivElement>(null);
  const isSelectionMode = useConversationStore(messageStateSelectors.isSelectionMode);
  const selectToHere = useConversationStore((s) => s.selectToHere);

  const handleClick = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const lineY = rect.top + rect.height / 2;

    // The last selectable message whose top edge sits at or above the line is
    // "here"; the store then selects everything from the top down to it
    // (including messages scrolled above the viewport).
    let targetId: string | undefined;
    for (const node of wrap.ownerDocument.querySelectorAll<HTMLElement>('[data-message-id]')) {
      if (node.getBoundingClientRect().top <= lineY) {
        targetId = node.dataset.messageId ?? targetId;
      }
    }
    if (targetId) selectToHere(targetId);
  }, [selectToHere]);

  if (!isSelectionMode) return null;

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={stylex.props(styles.wrap).className}
      gap={12}
      paddingInline={16}
      ref={wrapRef}
    >
      <div {...stylex.props(styles.line)} />
      <Button
        className={stylex.props(styles.button).className}
        icon={<Icon icon={ArrowDownToLine} />}
        shape={'round'}
        size={'small'}
        onClick={handleClick}
      >
        {t('messageForward.bar.selectToHere')}
      </Button>
      <div {...stylex.props(styles.line)} />
    </Flexbox>
  );
});

SelectToHereButton.displayName = 'MessageForwardSelectToHereButton';

export default SelectToHereButton;
