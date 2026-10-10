'use client';

import { toast } from '@lobehub/ui';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { buildAgentDocumentPath } from '@/features/AgentDocumentPage/navigation';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useSingleton } from '@/hooks/useSingleton';
import { useClientDataSWR } from '@/libs/swr';
import { portalKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';
import { invalidateDocumentMutation } from '@/services/document/invalidation';
import { useAgentStore } from '@/store/agent';
import { getDocumentRenderMode } from '@/utils/documentRenderMode';
import { standardizeIdentifier } from '@/utils/identifier';
import { isSkillMarkdownDocument } from '@/utils/skillMarkdown';

import { useResolvedAgentDocumentId, useResolvedDocumentId } from './documentViewContext';

export const TITLE_MAX_LENGTH = 100;

/**
 * Title state + rename action for the portal document header: the saved title
 * (title › filename), the loading flag, the meta lock, and a serialized title
 * write used by the `…` menu's rename dialog.
 */
export const usePortalDocumentTitle = () => {
  const { t } = useTranslation(['chat', 'common']);
  const documentId = useResolvedDocumentId();
  const agentId = useAgentStore((s) => s.activeAgentId);

  const {
    data: document,
    isLoading,
    mutate: mutateDocument,
  } = useClientDataSWR(documentId ? portalKeys.documentHeader(documentId) : null, () =>
    documentService.getDocumentById(documentId!),
  );

  const savedTitle = useMemo(
    () => document?.title || document?.filename || '',
    [document?.title, document?.filename],
  );
  // Anything the portal renders without the rich editor (highlight view,
  // file preview) must not be renameable here — matching the full-page
  // editor's `metaReadOnly` gate (#19760).
  const isReadonly = !!document && getDocumentRenderMode(document).mode !== 'editor';
  // A managed skill's `SKILL.md` index carries its identity in the filename —
  // a portal rename would push the new title into both `title` and `filename`
  // and desync the bundle. The full-page editor locks meta for the same reason
  // (see AgentDocumentPage's `metaReadOnly`); the rename API rejects it anyway.
  const isSkillIndex = !!document && isSkillMarkdownDocument(document);
  const metaLocked = isReadonly || isSkillIndex;

  // Serializes title writes end-to-end. Two layers:
  // 1. `saveChain` queues the SERVER calls — updateDocument mutations run
  //    in submit order, so a slow first request can never land after (and
  //    overwrite) a newer rename.
  // 2. `saveTicketRef` gates the CLIENT-side settlement — only the newest
  //    save may touch the SWR cache, so a rejected older request cannot roll
  //    back a newer intent.
  const saveChain = useSingleton(() => ({ current: Promise.resolve() as Promise<unknown> }));
  const saveTicketRef = useRef(0);

  const saveTitle = useCallback(
    async (title: string) => {
      const nextTitle = title.trim();
      // Empty or unchanged titles are not written.
      if (metaLocked || !nextTitle || nextTitle === savedTitle || !documentId) return;

      // Claim the newest save; only this ticket may settle the client state.
      const ticket = ++saveTicketRef.current;
      const previousTitle = savedTitle;

      // Optimistic update, then reconcile with the server response.
      mutateDocument((prev) => (prev ? { ...prev, title: nextTitle } : prev), {
        revalidate: false,
      });

      // Queue the server write behind any in-flight rename so the server sees
      // the titles in the order the user submitted them — a slow first request
      // can no longer land last and overwrite the newer title.
      const write = saveChain.current
        .catch(() => undefined)
        .then(() =>
          documentService.updateDocument({ id: documentId, title: nextTitle }).then((result) => {
            if (ticket !== saveTicketRef.current) return result;
            // Revalidate the caches other surfaces read titles from
            // (working-sidebar tree, standalone document page read
            // `agent:documentsList`), mirroring the full-page editor's
            // post-rename list refresh.
            void invalidateDocumentMutation({ agentId: agentId ?? undefined, documentId });
            return result;
          }),
        );
      saveChain.current = write;
      try {
        await write;
      } catch (error) {
        if (ticket !== saveTicketRef.current) return;
        toast.error(t('operationFailed', { ns: 'common' }));
        mutateDocument((prev) => (prev ? { ...prev, title: previousTitle } : prev), {
          revalidate: false,
        });
        // Reject so the rename dialog stays open with the typed title for a
        // retry instead of closing as if the write had landed.
        throw error;
      }
    },
    [agentId, documentId, metaLocked, mutateDocument, savedTitle, saveChain, t],
  );

  return {
    isLoading,
    metaLocked,
    savedTitle,
    saveTitle,
    titleFallback: t('agentDocument.portal.titlePlaceholder', { ns: 'chat' }),
  };
};

/**
 * In-app path of the full-page view for the portal document. An agent-bound
 * document opens in its agent's docs route; any other document (goal
 * deliverables, notebook docs) has no agent route to land on — that route
 * redirects unowned ids to the docs index — so it opens in the page editor.
 */
export const resolvePortalDocumentPath = (
  documentId: string | undefined,
  agentId: string | undefined,
  agentDocumentId: string | undefined,
): string | undefined => {
  if (!documentId) return undefined;
  if (agentId && agentDocumentId) return buildAgentDocumentPath(agentId, documentId);
  return `/page/${standardizeIdentifier(documentId)}`;
};

/**
 * Header menu actions shared by every portal document: the absolute link to
 * the full-page view and a refetch of the document from the server.
 */
export const usePortalDocumentHeaderActions = () => {
  const documentId = useResolvedDocumentId();
  // The resolved agent-documents binding is the ownership proof: only a bound
  // document may be linked through the active agent's docs route.
  const agentId = useAgentStore((s) => s.activeAgentId);
  const agentDocumentId = useResolvedAgentDocumentId();
  const appOrigin = useAppOrigin();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();

  const path = resolvePortalDocumentPath(documentId, agentId, agentDocumentId);
  const workspacePrefix = activeWorkspaceSlug ? `/${activeWorkspaceSlug}` : '';
  const url =
    path && appOrigin ? `${appOrigin.replace(/\/+$/, '')}${workspacePrefix}${path}` : undefined;

  const refresh = useCallback(async () => {
    if (!documentId) return;
    await invalidateDocumentMutation({
      agentDocumentId,
      agentId: agentDocumentId ? (agentId ?? undefined) : undefined,
      documentId,
    });
  }, [agentDocumentId, agentId, documentId]);

  return { agentDocumentId, agentId, documentId, path, refresh, url };
};
