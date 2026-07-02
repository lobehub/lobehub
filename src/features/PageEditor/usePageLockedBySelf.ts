'use client';

import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

import { usePageEditorStore } from './store';
import { usePageLockedByOther } from './usePageLockedByOther';

/**
 * Whether the current user is being blocked **by another session of their own**
 * (a different tab, a refresh that didn't release cleanly, an earlier mount whose
 * `release` call was aborted by unload, etc.).
 *
 * The signal is the unusual coincidence of "I am the recorded holder" AND
 * "something is rejecting my writes" — under healthy single-session usage those
 * never overlap. We surface this so the UI can stop telling the user that
 * `{their own name} is editing this document` (which reads like another person
 * has taken the page) and instead show a self-aware message.
 *
 * Forward-compatible with the session-aware (session-scoped lease-backed) lock refactor: once
 * `usePageLockedByOther` returns true for a different-session-same-user holder,
 * this hook will pick that up automatically — for now it relies primarily on
 * the `saveBlockedByLock` signal that CONFLICT save responses set.
 */
export const usePageLockedBySelf = (): boolean => {
  const documentId = usePageEditorStore((s) => s.documentId);
  const lockHolderId = usePageEditorStore((s) => s.lockHolderId);
  const myUserId = useUserStore(userProfileSelectors.userId);
  const isLockedByOther = usePageLockedByOther();
  const saveBlockedByLock = useDocumentStore((s) =>
    documentId ? editorSelectors.saveBlockedByLock(documentId)(s) : false,
  );

  if (!lockHolderId || !myUserId || lockHolderId !== myUserId) return false;

  return isLockedByOther || saveBlockedByLock;
};
