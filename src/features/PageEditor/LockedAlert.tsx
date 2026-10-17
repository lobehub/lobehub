'use client';

import { Alert } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthorInfo } from '@/business/client/hooks/useAuthorInfo';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';

import { usePageEditorStore } from './store';
import { usePageLockedByOther } from './usePageLockedByOther';
import { usePageLockedBySelf } from './usePageLockedBySelf';

/**
 * Prominent in-body notice shown when another workspace member holds the edit
 * lock: tells the user why the page is read-only and that their edits won't be
 * saved. The Header keeps a compact badge ({@link EditingIndicator}); this is
 * the explanatory surface so a blocked edit never looks unexplained.
 */
const LockedAlert = memo(() => {
  const { t } = useTranslation('file');
  const documentId = usePageEditorStore((s) => s.documentId);
  const isWorkspacePage = usePageEditorStore((s) => s.isWorkspacePage);
  const lockHolderId = usePageEditorStore((s) => s.lockHolderId);
  const isLockedByOther = usePageLockedByOther();
  const isLockedBySelf = usePageLockedBySelf();
  // Our own save was just rejected by the lock — treat as locked even if the
  // lock-service state hasn't caught up yet.
  const saveBlockedByLock = useDocumentStore((s) =>
    documentId ? editorSelectors.saveBlockedByLock(documentId)(s) : false,
  );
  const holder = useAuthorInfo(lockHolderId ?? undefined);

  if (!isWorkspacePage) return null;
  if (!isLockedByOther && !isLockedBySelf && !saveBlockedByLock) return null;

  // Same user, different session (other tab / unreleased prior mount): show a
  // self-aware message and a neutral info tone — it isn't a collaborator
  // conflict, just the user's own stale lease lingering until expiry.
  if (isLockedBySelf) {
    return (
      <Alert
        showIcon
        description={t('pageEditor.editMode.lockedBySelfDescription')}
        style={{ marginBlock: 8 }}
        title={t('pageEditor.editMode.lockedBySelf')}
        type="info"
      />
    );
  }

  const title = holder?.fullName
    ? t('pageEditor.editMode.lockedByOther', { name: holder.fullName })
    : t('pageEditor.editMode.lockedBySomeone');

  return (
    <Alert
      showIcon
      description={t('pageEditor.editMode.lockedDescription')}
      style={{ marginBlock: 8 }}
      title={title}
      type="warning"
    />
  );
});

LockedAlert.displayName = 'LockedAlert';

export default LockedAlert;
