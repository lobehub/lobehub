import type { DocumentReviewTextAnchor } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { useCallback, useEffect, useRef } from 'react';

import { useConversationStore } from '@/features/Conversation/store';
import {
  HIGHLIGHT_REGISTRY,
  supportsHighlightApi,
} from '@/features/PageEditor/DocumentComments/anchor/highlights';
import {
  buildAnchorRange,
  flattenEditorText,
  locateAnchor,
} from '@/features/PageEditor/DocumentComments/anchor/textAnchor';
import type { DocumentReviewImpactItem } from '@/services/documentReview';
import { documentReviewService } from '@/services/documentReview';
import { useFileStore } from '@/store/file';

import { usePageAgentPanelControl } from '../RightPanel/OverrideContext';
import { selectors, usePageEditorStore } from '../store';

/** How long the located sentence stays highlighted after a jump. */
const REVIEW_HIGHLIGHT_DURATION = 2600;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface UseReviewAnchorResult {
  askCopilot: (impact: DocumentReviewImpactItem) => Promise<boolean>;
  jumpToAnchor: (anchor?: DocumentReviewTextAnchor | null) => boolean;
}

/**
 * Body-side half of the review panel: turn a stored quote anchor into a
 * scrolled, highlighted range, and hand an impact item's context to Copilot.
 *
 * The locating and range building are the comment anchors' own helpers, so a
 * review jump and a comment jump can never disagree about where a quote is.
 * The transient paint reuses the comment `pending` registry, whose amber
 * underline is already mounted for every workspace page.
 */
export const useReviewAnchor = (): UseReviewAnchorResult => {
  const editor = usePageEditorStore(selectors.editor);
  const documentId = usePageEditorStore(selectors.documentId);
  const setRightPanelMode = usePageEditorStore((s) => s.setRightPanelMode);
  const composerTarget = useConversationStore((s) => s.composerTarget);
  const addSelectionContext = useFileStore((s) => s.addChatContextSelection);
  const { toggle: togglePageAgentPanel } = usePageAgentPanelControl();
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    },
    [],
  );

  const jumpToAnchor = useCallback(
    (anchor?: DocumentReviewTextAnchor | null) => {
      if (!anchor || anchor.invalid || !anchor.quote) return false;

      const root = editor?.getRootElement?.();
      if (!root) return false;

      const flat = flattenEditorText(root);
      if (!flat.text) return false;

      // The review anchor mirrors the comment anchor, but only the comment
      // type requires offsets; a missing hint simply falls back to context
      // matching inside `locateAnchor`.
      const match = locateAnchor(flat, {
        end: anchor.end ?? 0,
        prefix: anchor.prefix,
        quote: anchor.quote,
        start: anchor.start ?? 0,
        suffix: anchor.suffix,
      });
      if (!match) return false;

      const range = buildAnchorRange(flat, match);
      if (!range) return false;

      const target =
        range.startContainer.nodeType === Node.TEXT_NODE
          ? range.startContainer.parentElement
          : (range.startContainer as Element);

      target?.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'center',
      });

      if (supportsHighlightApi()) {
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
        CSS.highlights.set(HIGHLIGHT_REGISTRY.pending, new Highlight(range));
        clearTimerRef.current = setTimeout(() => {
          CSS.highlights.delete(HIGHLIGHT_REGISTRY.pending);
          clearTimerRef.current = null;
        }, REVIEW_HIGHLIGHT_DURATION);
      }

      return true;
    },
    [editor],
  );

  const askCopilot = useCallback(
    async (impact: DocumentReviewImpactItem) => {
      if (!composerTarget.writable) return false;

      try {
        // The router assembles both original excerpts from the *current* body,
        // so the chip carries fresh text even when the analysis ran earlier.
        const context = await documentReviewService.getImpactFollowUpContext({
          impactId: impact.id,
        });

        const relatedQuote = context.related?.anchor.quote;
        const content = [
          context.impact.title,
          `Changed text: ${context.source.anchor.quote}`,
          relatedQuote ? `Related text: ${relatedQuote}` : null,
          context.impact.reason ? `Why it matters: ${context.impact.reason}` : null,
        ]
          .filter(Boolean)
          .join('\n');

        addSelectionContext({
          contextKey: composerTarget.contextKey,
          selection: {
            content,
            format: 'text',
            id: `review-impact-${impact.id}-${nanoid(4)}`,
            pageId: documentId,
            preview: context.impact.title,
            title: context.impact.title,
            type: 'text',
          },
        });

        setRightPanelMode('copilot');
        togglePageAgentPanel(true);

        setTimeout(() => {
          const editors = [...document.querySelectorAll('[data-lexical-editor="true"]')];
          (editors.at(-1) as HTMLElement | undefined)?.focus();
        }, 300);

        return true;
      } catch (error) {
        console.error('[DocumentReview] Failed to build follow-up context:', error);
        return false;
      }
    },
    [addSelectionContext, composerTarget, documentId, setRightPanelMode, togglePageAgentPanel],
  );

  return { askCopilot, jumpToAnchor };
};
