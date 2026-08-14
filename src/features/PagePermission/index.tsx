'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import ResourceAccessPage from '@/features/ResourcePermission/ResourceAccessPage';
import { useClientDataSWR } from '@/libs/swr';
import { documentService } from '@/services/document';

/**
 * Member Permissions for one page/document — the Agent-style standalone page.
 * Reachable by managers only (creator / owner / admin); the shared page
 * redirects everyone else. Works for private pages too: the creator configures
 * what members get the moment the page is published.
 */
const PagePermission = memo(() => {
  const { t } = useTranslation('setting');
  const { id } = useParams<{ id: string }>();
  const { data } = useClientDataSWR(id ? ['page-permission-title', id] : null, () =>
    documentService.getDocumentById(id!),
  );

  if (!id) return null;

  return (
    <ResourceAccessPage
      redirectPath={`/page/${id}`}
      resourceHomePath={`/page/${id}`}
      resourceId={id}
      resourceName={data?.title}
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
