'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NotFound from '@/components/404';

/**
 * Terminal 404 card for a file whose fetch settled on nothing — it doesn't
 * exist or the viewer lost access (e.g. a workspace file switched back to
 * private by its owner). Render instead of a blank pane.
 */
const FileNotFound = memo(() => {
  const { t } = useTranslation('file');

  return <NotFound desc={t('notFound.desc')} title={t('notFound.title')} />;
});

FileNotFound.displayName = 'FileNotFound';

export default FileNotFound;
