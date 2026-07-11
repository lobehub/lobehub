'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowDownToLine } from 'lucide-react';
import { memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { messageStateSelectors, useConversationStore } from '../store';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    pointer-events: auto;
    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  line: css`
    flex: 1;
    block-size: 0;
    border-block-start: 1px dashed ${cssVar.colorBorder};
  `,
  // The "here" marker: a dashed rule across the chat area at ~25% from the
  // bottom edge, with the trigger centered on it. Purely a visual guide except
  // for the button, so it never blocks scrolling or message clicks.
  wrap: css`
    pointer-events: none;

    position: absolute;
    z-index: 20;
    inset-block-start: 75%;
    inset-inline: 0;
    transform: translateY(-50%);
  `,
}));

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
      className={styles.wrap}
      gap={12}
      paddingInline={16}
      ref={wrapRef}
    >
      <div className={styles.line} />
      <Button
        className={styles.button}
        icon={<Icon icon={ArrowDownToLine} />}
        shape={'round'}
        size={'small'}
        onClick={handleClick}
      >
        {t('messageForward.bar.selectToHere')}
      </Button>
      <div className={styles.line} />
    </Flexbox>
  );
});

SelectToHereButton.displayName = 'MessageForwardSelectToHereButton';

export default SelectToHereButton;
