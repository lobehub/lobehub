'use client';

import { createContext, type ReactNode, type RefObject, use, useEffect } from 'react';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';

import { usePageEditorStore } from '../store';
import { DocumentCommentAnchorsProvider } from './anchor/context';
import DocumentCommentHighlightStyle from './anchor/HighlightStyle';
import type { DocumentCommentsState } from './useDocumentCommentsState';
import { useDocumentCommentsState } from './useDocumentCommentsState';

const DocumentCommentsContext = createContext<DocumentCommentsState | null>(null);

interface DocumentCommentsProviderProps {
  children: ReactNode;
  documentId: string;
  /**
   * Whether the editor renders its own right panel. Without one there is no
   * comments panel, and anchored threads list below the body instead.
   */
  panelAvailable: boolean;
  /** The body's scroll container; the panel's cards follow its scroll. */
  paneRef: RefObject<HTMLElement | null>;
}

const DocumentCommentsStateProvider = ({
  children,
  documentId,
  paneRef,
  panelAvailable,
}: DocumentCommentsProviderProps) => {
  const commentsPanelOpen = usePageEditorStore((s) => s.commentsPanelOpen);
  const setCommentsPanelOpen = usePageEditorStore((s) => s.setCommentsPanelOpen);
  const gutterEnabled = panelAvailable && commentsPanelOpen;
  const state = useDocumentCommentsState({ documentId, gutterEnabled, paneRef, panelAvailable });

  // A selection being commented on, or a run picked in the body, is answered
  // in the comments panel: open it on demand. Keyed on tick counters, not the
  // picked value itself — both the store and `selectedRootId` compare by
  // content, so a repeated pick of the same run would otherwise look like no
  // change — so picking again after the panel was closed opens it again,
  // while closing it is never undone by the pick that opened it.
  const pickVersion = usePageEditorStore((s) =>
    s.pendingCommentAnchor?.documentId === documentId ? s.pendingCommentAnchorVersion : 0,
  );
  const { pickTick, selectedRootId } = state.anchors;
  useEffect(() => {
    if (!panelAvailable || !(pickVersion || pickTick || selectedRootId)) return;
    setCommentsPanelOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickVersion, pickTick, selectedRootId]);

  return (
    <DocumentCommentsContext value={state}>
      <DocumentCommentAnchorsProvider value={state.anchors}>
        <DocumentCommentHighlightStyle />
        {children}
      </DocumentCommentAnchorsProvider>
    </DocumentCommentsContext>
  );
};

/**
 * Hosts the comment state once for the whole editor so the panel beside the
 * text, the header toggle and the list below the body read the same caches.
 * Renders the children untouched when comments are unavailable (no
 * workspace, no document).
 */
export const DocumentCommentsProvider = ({
  children,
  documentId,
  paneRef,
  panelAvailable,
}: Omit<DocumentCommentsProviderProps, 'documentId'> & { documentId?: string }) => {
  const workspaceId = useActiveWorkspaceId();
  if (!workspaceId || !documentId) return children;
  return (
    <DocumentCommentsStateProvider
      documentId={documentId}
      key={documentId}
      paneRef={paneRef}
      panelAvailable={panelAvailable}
    >
      {children}
    </DocumentCommentsStateProvider>
  );
};

/** `null` outside a provider, i.e. where comments are unavailable. */
export const useDocumentComments = () => use(DocumentCommentsContext);
