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

const COPY = {
  deleted: {
    description: 'pageEditor.collab.deleted.description',
    title: 'pageEditor.collab.deleted.title',
  },
  too_large: {
    description: 'pageEditor.collab.tooLarge.description',
    title: 'pageEditor.collab.tooLarge.title',
  },
} as const;

const CollabBlockedBanner = memo(() => {
  const { t } = useTranslation('file');
  const blocked = usePageEditorStore((s) => s.collab?.blocked);
  if (!blocked) return null;

  return (
    <NoticeAlert
      showIcon
      description={t(COPY[blocked].description)}
      key={blocked}
      style={BANNER_STYLE}
      title={t(COPY[blocked].title)}
      type={blocked === 'deleted' ? 'warning' : 'error'}
    />
  );
});

CollabBlockedBanner.displayName = 'CollabBlockedBanner';

export default CollabBlockedBanner;
