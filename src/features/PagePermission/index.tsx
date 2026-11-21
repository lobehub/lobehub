'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { docsPagePath } from '@/features/ResourceHome/paths';
import ResourceAccessPage from '@/features/ResourcePermission/ResourceAccessPage';
import { pageActions, pageSelectors, usePageStore } from '@/store/page';

/**
 * Member Permissions for one page/document — the Agent-style standalone page.
 * Reachable by managers only (creator / owner / admin); the shared page
 * redirects everyone else. Works for private pages too: the creator configures
 * what members get the moment the page is published.
 */
const PagePermission = memo(() => {
  const { t } = useTranslation('setting');
  const { id } = useParams<{ id: string }>();
  // The page detail replica: the title paints from the page list or the
  // persisted detail row and revalidates in the background.
  pageActions.useFetchPageDetail(id);
  const title = usePageStore((s) => pageSelectors.getDocumentById(id)(s)?.title || undefined);

  if (!id) return null;

  return (
    <ResourceAccessPage
      redirectPath={docsPagePath(id)}
      resourceHomePath={docsPagePath(id)}
      resourceId={id}
      resourceName={title}
      resourceType={'document'}
      copy={{
        generalAccessDesc: t('permission.page.documentGeneralAccessDesc'),
        privateHint: t('permission.page.documentAccessLevelPrivateHint'),
        privateNotice: t('permission.page.documentPrivateNotice'),
      }}
    />
  );
});

PagePermission.displayName = 'PagePermission';

export default PagePermission;
