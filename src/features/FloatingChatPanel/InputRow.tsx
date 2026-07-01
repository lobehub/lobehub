'use client';

import { createGlobalStyle, createStaticStyles } from 'antd-style';
import { type FocusEvent, memo, useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { ChatInput } from '@/features/Conversation';

import HoverExpandBar from './HoverExpandBar';

const styles = createStaticStyles(({ css }) => ({
  row: css`
    position: relative;
    flex-shrink: 0;
  `,
  surface: css`
    view-transition-name: floating-chat-panel-input;
  `,
}));

const InputRowViewTransitionStyle = createGlobalStyle`
  ::view-transition-old(floating-chat-panel-input),
  ::view-transition-new(floating-chat-panel-input) {
    animation-duration: 240ms;
    animation-timing-function: cubic-bezier(0.32, 0.72, 0, 1);
  }
`;

interface ViewTransitionLike {
  finished: Promise<void>;
}

type DocumentWithVT = Document & {
  startViewTransition?: (cb: () => void) => ViewTransitionLike;
};

const supportsViewTransition =
  typeof document !== 'undefined' &&
  typeof (document as DocumentWithVT).startViewTransition === 'function';

// View Transition snapshots the DOM before and after this callback. The DOM mutation
// must commit synchronously inside it, otherwise the "after" snapshot is identical
// to the "before" one and nothing animates.
//
// Setting `view-transition-name: none` on <html> for the duration of the transition
// suppresses the default root snapshot, so only the named `floating-chat-panel-input`
// element participates. Elements outside the panel keep their native CSS animations
// instead of being frozen under the root crossfade.
const commitWithViewTransition = (commit: () => void) => {
  if (!supportsViewTransition) {
    commit();
    return;
  }
  const root = document.documentElement;
  const previousViewTransitionName = root.style.viewTransitionName;
  root.style.viewTransitionName = 'none';
  const transition = (document as DocumentWithVT).startViewTransition!(() => {
    // eslint-disable-next-line @eslint-react/dom/no-flush-sync
    flushSync(commit);
  });
  const restore = () => {
    root.style.viewTransitionName = previousViewTransitionName;
  };
  transition.finished.then(restore, restore);
};

const EMPTY_ACTIONS: never[] = [];
const EXPANDED_LEFT_ACTIONS: 'typo'[] = ['typo'];
const EXPANDED_RIGHT_ACTIONS: 'contextWindow'[] = ['contextWindow'];

export interface InputRowProps {
  isCollapsed: boolean;
  onExpand: () => void;
}

const InputRow = memo<InputRowProps>(({ isCollapsed, onExpand }) => {
  const s = styles;
  const [renderedCollapsed, setRenderedCollapsed] = useState(isCollapsed);
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (renderedCollapsed === isCollapsed) return;
    commitWithViewTransition(() => setRenderedCollapsed(isCollapsed));
  }, [isCollapsed, renderedCollapsed]);

  // Focus inside the collapsed strip releases the compact rendering so the action bar
  // (Send + actions) shows while the panel itself stays collapsed. Blurring back outside
  // the row returns to compact. View Transition makes the footer enter / leave smoothly.
  const handleFocus = useCallback(() => {
    if (focusedRef.current) return;
    focusedRef.current = true;
    commitWithViewTransition(() => setFocused(true));
  }, []);

  const handleBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    if (!focusedRef.current) return;
    focusedRef.current = false;
    commitWithViewTransition(() => setFocused(false));
  }, []);

  const effectiveCompact = renderedCollapsed && !focused;

  return (
    <>
      <InputRowViewTransitionStyle />
      <div
        className={s.row}
        data-collapsed={isCollapsed}
        data-testid="floating-chat-panel-input-row"
        onBlur={handleBlur}
        onFocus={handleFocus}
      >
        <HoverExpandBar visible={isCollapsed && focused} onExpand={onExpand} />
        <div className={s.surface}>
          <ChatInput
            allowExpand={false}
            compact={effectiveCompact}
            leftActions={effectiveCompact ? EMPTY_ACTIONS : EXPANDED_LEFT_ACTIONS}
            rightActions={effectiveCompact ? EMPTY_ACTIONS : EXPANDED_RIGHT_ACTIONS}
            showControlBar={false}
          />
        </div>
      </div>
    </>
  );
});

InputRow.displayName = 'FloatingChatPanelInputRow';

export default InputRow;
