'use client';

import { useEffect, useMemo, useRef } from 'react';

import { type EditLockClient, useEditLock } from '@/features/EditLock';
import { usePermission } from '@/hooks/usePermission';
import { mutate } from '@/libs/swr';
import { documentService } from '@/services/document';
import { documentSWRKeys } from '@/services/document/swrKeys';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';

import { usePageEditorStore } from './store';
import { usePageLockedByOther } from './usePageLockedByOther';

// Stable lock RPC binding for the document resource.
const documentLockClient: EditLockClient = {
  acquire: (id, ownerId) => documentService.acquireDocumentLock(id, ownerId),
  peek: (id, ownerId) => documentService.getDocumentLock(id, ownerId),
  release: (id, ownerId) => documentService.releaseDocumentLock(id, ownerId),
};

const createLockOwnerId = (documentId: string) => {
  const randomId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `page:${documentId}:${randomId}`;
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
  const isLockedByOther = usePageLockedByOther();
  const setLockState = usePageEditorStore((s) => s.setLockState);
  const setLockPending = usePageEditorStore((s) => s.setLockPending);
  const setLockHealth = usePageEditorStore((s) => s.setLockHealth);
  const setLockOwnerId = usePageEditorStore((s) => s.setLockOwnerId);
  const lockExpiresAt = usePageEditorStore((s) => s.lockExpiresAt);
  const isDirty = useDocumentStore((s) =>
    documentId ? editorSelectors.isDirty(documentId)(s) : false,
  );
  const saveBlockedByLock = useDocumentStore((s) =>
    documentId ? editorSelectors.saveBlockedByLock(documentId)(s) : false,
  );

  const workspacePage = Boolean(documentId && canEdit && isWorkspacePage);
  const ownerId = useMemo(
    () => (documentId ? createLockOwnerId(documentId) : undefined),
    [documentId],
  );

  useEffect(() => {
    setLockOwnerId(workspacePage ? ownerId : undefined);
    if (!documentId) return;

    useDocumentStore.getState().internal_dispatchDocument({
      id: documentId,
      type: 'updateDocument',
      value: { lockOwnerId: workspacePage ? ownerId : undefined },
    });

    return () => {
      setLockOwnerId(undefined);
      useDocumentStore.getState().internal_dispatchDocument({
        id: documentId,
        type: 'updateDocument',
        value: { lockOwnerId: undefined },
      });
    };
  }, [documentId, ownerId, setLockOwnerId, workspacePage]);

  // Shared lock lifecycle. Pages receive realtime lock pushes via SSE, so the
  // viewer poll is off — the single peek-on-open plus those pushes keep it live.
  const lock = useEditLock({
    client: documentLockClient,
    enabled: workspacePage,
    isDirty,
    ownerId,
    pollWhileViewing: false,
    resourceId: documentId,
  });

  // Bridge lock state into the page store. A peek failure / non-workspace page
  // resolves to "free" (pending false), so the editor is never stranded.
  useEffect(() => {
    setLockState(lock.holderId, lock.expiresAt, lock.ownerId);
  }, [lock.expiresAt, lock.holderId, lock.ownerId, setLockState]);

  useEffect(() => {
    setLockPending(lock.pending);
  }, [lock.pending, setLockPending]);

  useEffect(() => {
    setLockHealth(lock.health);
  }, [lock.health, setLockHealth]);

  // After recovering from a lost lease, refresh the document so we don't paint
  // over edits another member made while we were disconnected. The existing
  // isLockedByOther bridge above only fires when the holder transitions through
  // a different user — recovering from `lost` after a pure network blip never
  // touches holderId, so it needs its own trigger.
  const prevHealthRef = useRef(lock.health);
  useEffect(() => {
    const recovered = prevHealthRef.current === 'lost' && lock.health === 'healthy';
    prevHealthRef.current = lock.health;
    if (recovered && documentId) {
      void mutate(documentSWRKeys.editor(documentId));
    }
  }, [lock.health, documentId]);

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

  // Recovery: once the lock has resolved and the server confirms we can write
  // again, drop any stale save-block from an earlier CONFLICT. Without this the
  // editor stays read-only behind a banner that names the *current* holder
  // — possibly the user themselves — since the only other path that clears the
  // flag is a successful save the read-only editor can't reach.
  //
  // Uses `lock.lockedByOther` (the server's ownerId-aware verdict) rather than
  // `usePageLockedByOther` (a userId-only comparison): the latter is `false`
  // during a self-conflict, which would clear `saveBlockedByLock` between
  // CONFLICT'd saves and create a one-render flash of the lockedBySelf banner.
  useEffect(() => {
    if (!documentId || lock.pending || lock.lockedByOther || !saveBlockedByLock) return;
    useDocumentStore.getState().clearSaveBlockedByLock(documentId);
  }, [documentId, lock.pending, lock.lockedByOther, saveBlockedByLock]);

  // Lease-expiry re-peek: schedule a single confirmation peek at the lease's
  // expected expiry time. Runs for *any* known holder (us or someone else), so
  // a holder whose heartbeat silently stopped (or whose release was lost in
  // flight) doesn't strand viewers — and our own session can verify it still
  // owns the lock instead of trusting a stale lockExpiresAt.
  useEffect(() => {
    if (!workspacePage || !documentId || !ownerId || !lockExpiresAt) return;

    const expiresAtTime =
      lockExpiresAt instanceof Date ? lockExpiresAt.getTime() : new Date(lockExpiresAt).getTime();
    if (Number.isNaN(expiresAtTime)) return;

    const delay = Math.max(1000, expiresAtTime - Date.now() + 500);
    const timer = setTimeout(() => {
      documentService
        .getDocumentLock(documentId, ownerId)
        .then((nextLock) => setLockState(nextLock.holderId, nextLock.expiresAt, nextLock.ownerId))
        .catch((error) => {
          console.error('[PageEditor] Failed to refresh expired document lock:', error);
        });
    }, delay);

    return () => clearTimeout(timer);
  }, [documentId, lockExpiresAt, ownerId, setLockState, workspacePage]);
};
