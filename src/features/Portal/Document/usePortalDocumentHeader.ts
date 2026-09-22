'use client';

import { buildAgentDocumentUrl } from '@lobechat/builtin-tool-agent-documents';
import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useSingleton } from '@/hooks/useSingleton';
import { useClientDataSWR } from '@/libs/swr';
import { portalKeys } from '@/libs/swr/keys';
import { documentService } from '@/services/document';
import { invalidateDocumentMutation } from '@/services/document/invalidation';
import { useAgentStore } from '@/store/agent';
import { getDocumentRenderMode } from '@/utils/documentRenderMode';
import { isSkillMarkdownDocument } from '@/utils/skillMarkdown';

import { useResolvedAgentDocumentId, useResolvedDocumentId } from './documentViewContext';

export const TITLE_MAX_LENGTH = 100;

/**
 * Title state + actions for the portal document header: the saved title
 * (title › filename), the loading flag, and an edit/commit cycle that
 * persists through the document service.
 *
 * `syncIdleDraft` is called from a `useEffect` keyed on the editing flag —
 * the hook stays headless; the component decides when to resync.
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

  const [draft, setDraft] = useState(savedTitle);
  const [editing, setEditing] = useState(false);
  // Serializes title writes end-to-end. Two layers:
  // 1. `saveChain` queues the SERVER calls — updateDocument mutations run
  //    in submit order, so a slow first request can never land after (and
  //    overwrite) a newer rename.
  // 2. `saveTicketRef` gates the CLIENT-side settlement — only the newest
  //    commit may touch the draft/SWR cache, so a rejected older request
  //    cannot roll back a newer intent.
  const saveChain = useSingleton(() => ({ current: Promise.resolve() as Promise<unknown> }));
  const saveTicketRef = useRef(0);

  // Follow the SWR source while idle; never clobber a draft mid-typing.
  const syncIdleDraft = useCallback(
    (isEditing: boolean) => {
      if (!isEditing) setDraft(savedTitle);
    },
    [savedTitle],
  );

  const startEdit = useCallback(() => {
    if (metaLocked) return;
    setDraft(savedTitle);
    setEditing(true);
  }, [metaLocked, savedTitle]);

  // Marks the in-progress edit as cancelled. Escape calls this BEFORE blurring
  // the input: the blur that follows still fires `commitEdit`, but the flag
  // makes that commit a no-op restore instead of persisting the edited draft
  // the user just threw away.
  const cancelEditRef = useRef(false);

  const cancelEdit = useCallback(() => {
    cancelEditRef.current = true;
    setDraft(savedTitle);
    setEditing(false);
  }, [savedTitle]);

  const commitEdit = useCallback(async () => {
    // A cancelled edit restores, it never writes — even though the blur event
    // hands us the still-edited draft.
    if (cancelEditRef.current) {
      cancelEditRef.current = false;
      return;
    }
    const nextTitle = draft.trim();
    // Empty or unchanged drafts fall back to the saved title — no write.
    if (!nextTitle || nextTitle === savedTitle || !documentId) {
      setDraft(savedTitle);
      setEditing(false);
      return;
    }

    // Claim the newest save; only this ticket may settle the client state.
    const ticket = ++saveTicketRef.current;
    setEditing(false);
    setDraft(nextTitle);

    // Optimistic update, then reconcile with the server response.
    mutateDocument((prev) => (prev ? { ...prev, title: nextTitle } : prev), { revalidate: false });

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
    } catch {
      if (ticket !== saveTicketRef.current) return;
      toast.error(t('operationFailed', { ns: 'common' }));
      setDraft(savedTitle);
      mutateDocument((prev) => (prev ? { ...prev, title: savedTitle } : prev), {
        revalidate: false,
      });
    }
  }, [agentId, draft, documentId, mutateDocument, savedTitle, t]);

  return {
    cancelEdit,
    commitEdit,
    draft,
    editing,
    isLoading,
    metaLocked,
    savedTitle,
    setDraft,
    startEdit,
    syncIdleDraft,
    titleFallback: t('agentDocument.portal.titlePlaceholder', { ns: 'chat' }),
  };
};

/**
 * Header menu entries: rename (hidden when meta is locked) and copy link
 * (only when the portal viewer carries the agent-documents binding that
 * proves the active agent owns the document).
 */
export const usePortalDocumentHeaderActions = () => {
  const { t } = useTranslation(['chat', 'file', 'common']);
  const documentId = useResolvedDocumentId();
  // The doc-anchored chat topic binds (agentId, documentId); the standalone
  // route for "copy link" needs the owning agent id, which equals the store's
  // activeAgentId inside this portal (see Body's panelEligible gate). The
  // resolved agent-documents binding is the ownership proof: a plain notebook
  // document opened beside an active agent must not produce a copy-link for an
  // agent route that doesn't own it.
  const agentId = useAgentStore((s) => s.activeAgentId);
  const agentDocumentId = useResolvedAgentDocumentId();
  const appOrigin = useAppOrigin();
  const activeWorkspaceSlug = useActiveWorkspaceSlug();

  const { startEdit } = usePortalDocumentTitle();

  const copyLink = useCallback(async () => {
    // The binding is the runtime guard too: even a stale callback handed to a
    // menu must never compose an agent-document URL for an unowned document.
    if (!documentId || !agentId || !agentDocumentId) return;
    const url = buildAgentDocumentUrl(appOrigin, agentId, documentId, {
      workspaceSlug: activeWorkspaceSlug,
    });
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast.success(t('agentDocument.linkCopied', { ns: 'chat' }));
  }, [activeWorkspaceSlug, agentDocumentId, agentId, appOrigin, documentId, t]);

  return { agentDocumentId, agentId, copyLink, documentId, startEdit, t };
};
