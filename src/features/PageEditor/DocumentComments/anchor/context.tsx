'use client';

import { createContext, type ReactNode, use } from 'react';

import type { DocumentCommentAnchorsValue } from './useDocumentCommentAnchors';

const noop = () => {};

/**
 * Keeps cards that render outside the list — the pinned deep-link thread
 * mounts before the list exists — from having to null-check the resolution.
 */
const FALLBACK: DocumentCommentAnchorsValue = {
  activeRootId: null,
  locateInBody: noop,
  orphanedRootIds: new Set(),
  setHoveredRootId: noop,
};

const DocumentCommentAnchorsContext = createContext<DocumentCommentAnchorsValue>(FALLBACK);

/**
 * Anchors are resolved once for the whole list — one DOM walk, one repaint —
 * and read by every card, so the resolution lives in context rather than being
 * recomputed per card.
 */
export const DocumentCommentAnchorsProvider = ({
  children,
  value,
}: {
  children: ReactNode;
  value: DocumentCommentAnchorsValue;
}) => <DocumentCommentAnchorsContext value={value}>{children}</DocumentCommentAnchorsContext>;

export const useCommentAnchors = (): DocumentCommentAnchorsValue =>
  use(DocumentCommentAnchorsContext);
