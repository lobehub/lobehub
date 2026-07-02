'use client';

import { usePermission } from '@/hooks/usePermission';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';

import { usePageEditorStore } from './store';
import { usePageLockedByOther } from './usePageLockedByOther';

/**
 * Whether the current user can type into the page right now.
 *
 * Workspace pages behave like personal pages — open and type — except that the
 * page becomes read-only while another member holds the edit lock. The lock is
 * acquired implicitly on the first edit; a peek on open (see {@link useDocumentLock})
 * surfaces an existing holder so the page is read-only up front.
 */
export const usePageEditable = (): boolean => {
  const { allowed: hasEditPermission } = usePermission('edit_own_content');
  const documentId = usePageEditorStore((s) => s.documentId);
  const isWorkspacePage = usePageEditorStore((s) => s.isWorkspacePage);
  const isLockedByOther = usePageLockedByOther();
  // Read-only until the lock resolves, so the user can't start typing on a page
  // that turns out to be locked and get bounced mid-edit. Only workspace pages
  // lock — personal pages are always immediately editable (no lock, no pending).
  const isLockPending = usePageEditorStore((s) => s.isLockPending);
  // A save already rejected by the lock → stop editing now (the EditingIndicator
  // tells the user why). Reactive, so the editor flips read-only the moment it happens.
  const saveBlockedByLock = useDocumentStore((s) =>
    documentId ? editorSelectors.saveBlockedByLock(documentId)(s) : false,
  );
  const pendingLock = isWorkspacePage && isLockPending;

  return hasEditPermission && !isLockedByOther && !pendingLock && !saveBlockedByLock;
};
