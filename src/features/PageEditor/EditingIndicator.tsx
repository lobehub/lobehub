'use client';

import { Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Loader2Icon, PencilIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthorInfo } from '@/business/client/hooks/useAuthorInfo';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';

import { usePageEditorStore } from './store';

/**
 * Edit-lock status line at the top of the page body: a "checking…" hint while
 * the lock resolves (page read-only meanwhile), then "someone else is editing"
 * if another member holds it. Renders nothing once the page is confirmed free —
 * a personal page then looks exactly the same (no edit-mode controls).
 */
const EditingIndicator = memo(() => {
  const { t } = useTranslation('file');
  const documentId = usePageEditorStore((s) => s.documentId);
  const isWorkspacePage = usePageEditorStore((s) => s.isWorkspacePage);
  const isLockedByOther = usePageEditorStore((s) => s.isLockedByOther);
  const isLockPending = usePageEditorStore((s) => s.isLockPending);
  const lockHolderId = usePageEditorStore((s) => s.lockHolderId);
  // Our own save was just rejected by the lock — treat as locked even if the
  // lock-service state hasn't caught up yet.
  const saveBlockedByLock = useDocumentStore((s) =>
    documentId ? editorSelectors.saveBlockedByLock(documentId)(s) : false,
  );
  const holder = useAuthorInfo(lockHolderId ?? undefined);

  if (!isWorkspacePage) return null;

  const lockedByOther = isLockedByOther || saveBlockedByLock;

  if (!lockedByOther) {
    if (!isLockPending) return null;

    return (
      <Flexbox horizontal align={'center'} gap={4} style={{ color: cssVar.colorTextTertiary }}>
        <Icon spin icon={Loader2Icon} size={14} />
        <Text ellipsis style={{ color: 'inherit', fontSize: 12, maxWidth: 240 }}>
          {t('pageEditor.editMode.checking')}
        </Text>
      </Flexbox>
    );
  }

  const label = holder?.fullName
    ? t('pageEditor.editMode.lockedByOther', { name: holder.fullName })
    : t('pageEditor.editMode.lockedBySomeone');

  return (
    <Tooltip title={label}>
      <Flexbox horizontal align={'center'} gap={4} style={{ color: cssVar.colorTextTertiary }}>
        <Icon icon={PencilIcon} size={14} />
        <Text ellipsis style={{ color: 'inherit', fontSize: 12, maxWidth: 240 }}>
          {label}
        </Text>
      </Flexbox>
    </Tooltip>
  );
});

export default EditingIndicator;
