'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { memo, type MouseEvent, type ReactNode, useCallback } from 'react';

import { CONVERSATION_MIN_WIDTH } from '@/const/layoutTokens';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { messageStateSelectors, useConversationStore } from '../store';
import { isSelectableRole } from './selectableRoles';
import SelectCircle from './SelectCircle';

const styles = createStaticStyles(({ css }) => ({
  // Full-bleed clickable band, WeChat-style. Stretches to the full stream width
  // regardless of the reading-column preference; the lane inside keeps the
  // content at its normal width. Kept light: selection uses the weakest fill
  // (the filled circle is the real indicator); hover is one notch up.
  band: css`
    cursor: pointer;
    user-select: none;
    inline-size: 100%;
    transition: background-color 0.1s ${cssVar.motionEaseInOut};

    &:hover {
      background-color: ${cssVar.colorFillTertiary};
    }
  `,
  bandSelected: css`
    background-color: ${cssVar.colorFillQuaternary};

    &:hover {
      background-color: ${cssVar.colorFillQuaternary};
    }
  `,
  // Pinned to the band's leading edge; vertical centering is handled by the
  // band's cross-axis alignment.
  checkbox: css`
    flex: none;
    padding-inline-start: 16px;
  `,
  content: css`
    /* Content is non-interactive while selecting — the whole row is the toggle. */
    pointer-events: none;
    flex: 1;
    min-width: 0;

    /* The hover action bar is suppressed in selection mode, so collapse its 28px
       placeholder too — otherwise every selected row carries a big empty
       highlighted strip beneath the bubble. */
    [data-user-action-bar-portal],
    [data-assitant-action-bar-portal],
    [data-assistant-group-action-bar-portal] {
      display: none;
    }

    /* The avatar + name + time header is redundant while scanning to select —
       drop it so every turn reads as one clean line. */
    .message-header {
      display: none;
    }
  `,
  // Assistant turns flow from the leading edge of the lane. User turns keep their
  // native right alignment + indent so they still read as "sent by the user".
  contentAssistant: css`
    .message-wrapper {
      align-items: flex-start !important;
      padding-inline-start: 0 !important;
    }
  `,
  // Assistant turns (esp. tool-call workflows) are long; fold them to a preview
  // height while selecting so the list stays scannable. Fades out at the bottom.
  contentCollapsed: css`
    overflow: hidden;
    max-height: 84px;

    mask-image: linear-gradient(to bottom, #000 56%, transparent 100%);
  `,
  disabledBand: css`
    cursor: not-allowed;
    inline-size: 100%;
    opacity: 0.4;
  `,
  // Centered reading column inside the full-bleed band — the width preference the
  // rest of the conversation follows.
  lane: css`
    padding-inline: 16px;
  `,
}));

interface MessageSelectionWrapperProps {
  children: ReactNode;
  id: string;
  role?: string;
}

/**
 * In multi-select mode, wraps a message with a full-bleed clickable band and a
 * round checkbox pinned to the band's leading edge. The band stretches to the
 * full stream width, while the inner lane keeps the content at the usual
 * reading-column width. Outside selection mode it renders the message untouched.
 */
const MessageSelectionWrapper = memo<MessageSelectionWrapperProps>(({ children, id, role }) => {
  const isSelectionMode = useConversationStore(messageStateSelectors.isSelectionMode);
  const isSelected = useConversationStore(messageStateSelectors.isMessageSelected(id));
  const toggleMessageSelected = useConversationStore((s) => s.toggleMessageSelected);
  const selectRange = useConversationStore((s) => s.selectRange);
  const wideScreen = useGlobalStore(systemStatusSelectors.wideScreen);

  const selectable = isSelectableRole(role);
  const isAssistant = role === 'assistant' || role === 'assistantGroup';

  const handleToggle = useCallback(
    (event: MouseEvent) => {
      if (!selectable) return;
      // Shift-click extends the selection from the anchor to this message.
      if (event.shiftKey) selectRange(id);
      else toggleMessageSelected(id);
    },
    [selectable, selectRange, toggleMessageSelected, id],
  );

  if (!isSelectionMode) return <>{children}</>;

  // Mirror WideScreenContainer's column width so selection content lines up with
  // the rest of the conversation.
  const laneWidth = wideScreen ? '100%' : `min(${CONVERSATION_MIN_WIDTH}px, 100%)`;

  const inner = (
    <>
      <div className={styles.checkbox}>{selectable && <SelectCircle checked={isSelected} />}</div>
      <Flexbox align={'center'} flex={1} style={{ minWidth: 0 }}>
        <Flexbox className={styles.lane} width={laneWidth}>
          <div
            className={cx(
              styles.content,
              isAssistant && styles.contentAssistant,
              isAssistant && styles.contentCollapsed,
            )}
          >
            {children}
          </div>
        </Flexbox>
      </Flexbox>
    </>
  );

  if (!selectable) {
    return (
      <Flexbox horizontal align={'center'} className={styles.disabledBand}>
        {inner}
      </Flexbox>
    );
  }

  return (
    <Flexbox
      horizontal
      align={'center'}
      className={cx(styles.band, isSelected && styles.bandSelected)}
      onClick={handleToggle}
    >
      {inner}
    </Flexbox>
  );
});

MessageSelectionWrapper.displayName = 'MessageSelectionWrapper';

export default MessageSelectionWrapper;
