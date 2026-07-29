'use client';

import { createContext, useContext } from 'react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

interface DocumentViewContextValue {
  agentDocumentId?: string;
  documentId?: string;
  /**
   * Standalone full-page document route (vs. the in-chat portal). When set, the
   * editor content is width-constrained like the conversation and the floating
   * chat panel is hidden (the working sidebar already provides chat).
   */
  fullPage?: boolean;
}

const DocumentViewContext = createContext<DocumentViewContextValue | null>(null);

/**
 * Provide an explicit document id to the shared Document viewer primitives
 * (Wrapper / Header / Body / EditorCanvas), so they can render outside the chat
 * portal stack — e.g. on the standalone `/agent/:aid/docs/:docId` route.
 */
export const DocumentViewProvider = DocumentViewContext.Provider;

/**
 * Document id for the current viewer. Inside a {@link DocumentViewProvider} it
 * returns the provided id; otherwise it falls back to the portal stack, so the
 * in-chat portal keeps working unchanged.
 */
export const useResolvedDocumentId = (): string | undefined => {
  const ctx = useContext(DocumentViewContext);
  const portalDocumentId = useChatStore(chatPortalSelectors.portalDocumentId);
  return ctx ? ctx.documentId : portalDocumentId;
};

/** Agent-documents association id, resolved the same way as the document id. */
export const useResolvedAgentDocumentId = (): string | undefined => {
  const ctx = useContext(DocumentViewContext);
  const portalAgentDocumentId = useChatStore(chatPortalSelectors.portalAgentDocumentId);
  return ctx ? ctx.agentDocumentId : portalAgentDocumentId;
};

/** Whether the viewer is the standalone full-page route (vs. the in-chat portal). */
export const useDocumentViewFullPage = (): boolean => !!useContext(DocumentViewContext)?.fullPage;
