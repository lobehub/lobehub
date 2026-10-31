'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, type MouseEvent, type ReactNode, useCallback } from 'react';

import { CONVERSATION_MIN_WIDTH } from '@/const/layoutTokens';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { sx } from '@/styles/sx';

import { messageStateSelectors, useConversationStore } from '../store';
import contentStyles from './MessageSelectionWrapper.module.css';
import { isSelectableRole } from './selectableRoles';
import SelectCircle from './SelectCircle';

const styles = stylex.create({
  // Full-bleed clickable band, WeChat-style. Stretches to the full stream width
  // regardless of the reading-column preference; the lane inside keeps the
  // content at its normal width. Kept light: selection uses the weakest fill
  // (the filled circle is the real indicator); hover is one notch up.
  band: {
    cursor: 'pointer',
    userSelect: 'none',
    inlineSize: '100%',
    transition: `background-color 0.1s ${cssVar.motionEaseInOut}`,
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
  },
  // Composed after `band`: a conditional value replaces the whole property.
  bandSelected: { backgroundColor: cssVar.colorFillQuaternary },
  // Pinned to the band's leading edge; vertical centering is handled by the
  // band's cross-axis alignment.
  checkbox: { flex: 'none', paddingInlineStart: '16px' },
  content: {
    // Content is non-interactive while selecting — the whole row is the toggle.
    pointerEvents: 'none',
    flex: '1',
    minWidth: 0,
  },
  // Assistant turns (esp. tool-call workflows) are long; fold them to a preview
  // height while selecting so the list stays scannable. Fades out at the bottom.
  contentCollapsed: {
    overflow: 'hidden',
    maxHeight: '84px',
    maskImage: 'linear-gradient(to bottom, #000 56%, transparent 100%)',
  },
  disabledBand: { cursor: 'not-allowed', inlineSize: '100%', opacity: 0.4 },
  // Centered reading column inside the full-bleed band — the width preference the
  // rest of the conversation follows.
  lane: { paddingInline: '16px' },
});

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
      <div {...stylex.props(styles.checkbox)}>
        {selectable && <SelectCircle checked={isSelected} />}
      </div>
      <Flexbox align={'center'} flex={1} style={{ minWidth: 0 }}>
        <Flexbox {...stylex.props(styles.lane)} width={laneWidth}>
          <div
            {...sx(
              [styles.content, isAssistant && styles.contentCollapsed],
              isAssistant
                ? `${contentStyles.content} ${contentStyles.contentAssistant}`
                : contentStyles.content,
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
      <Flexbox horizontal align={'center'} {...stylex.props(styles.disabledBand)}>
        {inner}
      </Flexbox>
    );
  }

  return (
    <Flexbox
      horizontal
      align={'center'}
      {...stylex.props(styles.band, isSelected && styles.bandSelected)}
      onClick={handleToggle}
    >
      {inner}
    </Flexbox>
  );
});

MessageSelectionWrapper.displayName = 'MessageSelectionWrapper';

export default MessageSelectionWrapper;
