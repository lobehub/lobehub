import { useCallback, useRef } from 'react';

import { CONVERSATION_SCROLLER_END_BLEED_VAR } from '@/features/Conversation/ChatList/constants';

/**
 * Lets the conversation's message scroller run underneath a panel floating at
 * the column's inline end, so its scrollbar sits on the column edge instead of
 * in the gap between the messages and the panel.
 *
 * Attach `hostRef` to an element enclosing the conversation and `panelRef` to
 * the panel's slot. The slot's live width is written to the host as
 * {@link CONVERSATION_SCROLLER_END_BLEED_VAR}. The slot animates its width, so
 * the value goes straight to the DOM on every frame instead of through state.
 */
export const useScrollerEndBleed = () => {
  const hostRef = useRef<HTMLDivElement>(null);

  const panelRef = useCallback((panel: HTMLElement | null) => {
    if (!panel) return;

    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.borderBoxSize?.[0]?.inlineSize ?? panel.getBoundingClientRect().width;
      hostRef.current?.style.setProperty(CONVERSATION_SCROLLER_END_BLEED_VAR, `${width}px`);
    });
    observer.observe(panel);

    return () => {
      observer.disconnect();
      hostRef.current?.style.removeProperty(CONVERSATION_SCROLLER_END_BLEED_VAR);
    };
  }, []);

  return { hostRef, panelRef };
};
