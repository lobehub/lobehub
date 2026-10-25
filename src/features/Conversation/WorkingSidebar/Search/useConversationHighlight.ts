import { useEffect } from 'react';

import { VLIST_CLASS_NAME } from '../../ChatList/constants';
import {
  clearTopicSearchHighlights,
  findKeywordRanges,
  paintTopicSearchHighlights,
  supportsHighlightApi,
} from './conversationHighlights';

const findMessageElement = (messageId: string) =>
  document.getElementById(messageId) ??
  document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`);

/**
 * Marks the keyword in the rendered conversation rows while the search pane is
 * visible, and repaints whenever rows mount, stream, or unmount.
 */
export const useConversationHighlight = ({
  activeMessageId,
  enabled,
  keyword,
}: {
  activeMessageId?: string;
  enabled: boolean;
  keyword: string;
}) => {
  useEffect(() => {
    if (!enabled || !keyword.trim() || !supportsHighlightApi()) return;

    let frame: number | undefined;
    const paint = () => {
      frame = undefined;
      const activeElement = activeMessageId ? findMessageElement(activeMessageId) : null;
      const all: Range[] = [];
      const active: Range[] = [];
      for (const root of document.querySelectorAll(`.${VLIST_CLASS_NAME}`)) {
        for (const range of findKeywordRanges(root, keyword)) {
          all.push(range);
          if (activeElement?.contains(range.startContainer)) active.push(range);
        }
      }
      paintTopicSearchHighlights(all, active);
    };
    const schedule = () => {
      frame ??= requestAnimationFrame(paint);
    };

    paint();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { characterData: true, childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTopicSearchHighlights();
    };
  }, [activeMessageId, enabled, keyword]);
};
