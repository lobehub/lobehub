'use client';

import { useEffect, useRef } from 'react';

import { type EditLockClient, useEditLock } from '@/features/EditLock';
import { usePermission } from '@/hooks/usePermission';
import { mutate } from '@/libs/swr';
import { documentService } from '@/services/document';
import { documentSWRKeys } from '@/services/document/swrKeys';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';

import { usePageEditorStore } from './store';

// Stable lock RPC binding for the document resource.
const documentLockClient: EditLockClient = {
  acquire: (id) => documentService.acquireDocumentLock(id),
  peek: (id) => documentService.getDocumentLock(id),
  release: (id) => documentService.releaseDocumentLock(id),
};

/**
 * Drives the collaborative edit lock for workspace pages.
 *
 * The core lifecycle — peek-on-open (read-only until resolved), acquire on the
 * first edit, heartbeat, release on unmount — is the shared {@link useEditLock}
 * primitive. This wrapper bridges its state into the PageEditor store (where
 * {@link usePageEditable} and the header indicator read it) and layers on the
 * page-only concerns: realtime lock pushes ({@link useResourceEvents}) replace
 * the viewer poll, and a lock flip re-hydrates content so a stale local snapshot
 * can't overwrite another member's edits.
 */
export const useDocumentLock = () => {
  const { allowed: canEdit } = usePermission('edit_own_content');
  const documentId = usePageEditorStore((s) => s.documentId);
  const isWorkspacePage = usePageEditorStore((s) => s.isWorkspacePage);
  const isLockedByOther = usePageEditorStore((s) => s.isLockedByOther);
  const setLockState = usePageEditorStore((s) => s.setLockState);
  const setLockPending = usePageEditorStore((s) => s.setLockPending);
  const isDirty = useDocumentStore((s) =>
    documentId ? editorSelectors.isDirty(documentId)(s) : false,
  );
  const saveBlockedByLock = useDocumentStore((s) =>
    documentId ? editorSelectors.saveBlockedByLock(documentId)(s) : false,
  );

  const workspacePage = Boolean(documentId && canEdit && isWorkspacePage);

  // Shared lock lifecycle. Pages receive realtime lock pushes via SSE, so the
  // viewer poll is off — the single peek-on-open plus those pushes keep it live.
  const lock = useEditLock({
    client: documentLockClient,
    enabled: workspacePage,
    isDirty,
    pollWhileViewing: false,
    resourceId: documentId,
  });

  // Bridge lock state into the page store. A peek failure / non-workspace page
  // resolves to "free" (pending false), so the editor is never stranded.
  useEffect(() => {
    setLockState({ holderId: lock.holderId, lockedByOther: lock.lockedByOther });
  }, [lock.holderId, lock.lockedByOther, setLockState]);

  useEffect(() => {
    setLockPending(lock.pending);
  }, [lock.pending, setLockPending]);

  // Re-hydrate content whenever the lock flips — on open if already held, or when
  // another member takes/releases it (events land in the store via the bridge or
  // useResourceEvents), or when our own save was just rejected (the holder's
  // version is newer). Prevents a stale snapshot from clobbering their edits.
  const wasLockedByOtherRef = useRef(false);
  useEffect(() => {
    if (!workspacePage || !documentId) {
      wasLockedByOtherRef.current = false;
      return;
    }
    const tookOver = wasLockedByOtherRef.current && !isLockedByOther;
    wasLockedByOtherRef.current = Boolean(isLockedByOther);
    if (isLockedByOther || tookOver || saveBlockedByLock) {
      void mutate(documentSWRKeys.editor(documentId));
    }
  }, [workspacePage, documentId, isLockedByOther, saveBlockedByLock]);
};
