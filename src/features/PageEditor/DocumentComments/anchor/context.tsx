'use client';

import { createContext, type ReactNode, use } from 'react';

import type { DocumentCommentAnchorsValue } from './useDocumentCommentAnchors';

const noop = () => {};
const nullValue = () => null;

/**
 * Keeps cards that render outside the list — the pinned deep-link thread
 * mounts before the list exists — from having to null-check the resolution.
 */
const FALLBACK: DocumentCommentAnchorsValue = {
  activeRootId: null,
  bodyElement: null,
  getAnchorMatch: nullValue,
  getAnchorRange: nullValue,
  getPendingAnchorRange: nullValue,
  locateInBody: noop,
  orphanedRootIds: new Set(),
  pickTick: 0,
  resolvedAt: 0,
  selectedRootId: null,
  selectRoot: noop,
  setHoveredRootId: noop,
};

const DocumentCommentAnchorsContext = createContext<DocumentCommentAnchorsValue>(FALLBACK);

/**
 * Anchors are resolved once for the whole document — one DOM walk, one
 * repaint — and read by every card and by the gutter, so the resolution lives
 * in context rather than being recomputed per card.
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
