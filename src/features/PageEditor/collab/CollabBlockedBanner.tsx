'use client';

import { type CSSProperties, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { NoticeAlert } from '@/components/NoticeAlert';

import { usePageEditorStore } from '../store';

const BANNER_STYLE: CSSProperties = {
  insetBlockStart: 0,
  marginBlock: 8,
  position: 'sticky',
  zIndex: 2,
};

const NOTICE = {
  deleted: {
    description: 'pageEditor.collab.deleted.description',
    title: 'pageEditor.collab.deleted.title',
    type: 'warning',
  },
  near_full: {
    description: 'pageEditor.collab.nearFull.description',
    title: 'pageEditor.collab.nearFull.title',
    type: 'warning',
  },
  too_large: {
    description: 'pageEditor.collab.tooLarge.description',
    title: 'pageEditor.collab.tooLarge.title',
    type: 'error',
  },
} as const;

const CollabBlockedBanner = memo(() => {
  const { t } = useTranslation('file');
  const notice = usePageEditorStore((s) => {
    if (s.collab?.blocked) return s.collab.blocked;
    return s.collab?.capacity === 'near_full' ? 'near_full' : undefined;
  });
  if (!notice) return null;

  return (
    <NoticeAlert
      showIcon
      description={t(NOTICE[notice].description)}
      key={notice}
      style={BANNER_STYLE}
      title={t(NOTICE[notice].title)}
      type={NOTICE[notice].type}
    />
  );
});

CollabBlockedBanner.displayName = 'CollabBlockedBanner';

export default CollabBlockedBanner;
