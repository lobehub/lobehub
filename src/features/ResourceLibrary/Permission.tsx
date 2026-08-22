'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { useKnowledgeBaseItem } from '@/features/ResourceManager/hooks/useKnowledgeItem';
import ResourceAccessPage from '@/features/ResourcePermission/ResourceAccessPage';

/**
 * Member Permissions for one knowledge base — the Agent-style standalone page.
 * Reachable by managers only (creator / owner / admin); the shared page
 * redirects everyone else. Works for private KBs too: the creator configures
 * what members get the moment the KB is published.
 */
const LibraryPermission = memo(() => {
  const { t } = useTranslation('setting');
  const { id } = useParams<{ id: string }>();
  // Managers can always browse, so the name fetch never 403s for a viewer of
  // this page; a transient failure just falls back to the generic title.
  const { data } = useKnowledgeBaseItem(id || '');

  if (!id) return null;

  return (
    <ResourceAccessPage
      showCollaborators
      redirectPath={'/resource'}
      resourceHomePath={`/resource/library/${id}`}
      resourceId={id}
      resourceName={data?.name}
      resourceType={'knowledgeBase'}
      copy={{
        collaboratorsDesc: t('permission.collaborators.libraryDesc'),
        generalAccessDesc: t('permission.page.libraryGeneralAccessDesc'),
        privateHint: t('permission.page.libraryAccessLevelPrivateHint'),
        privateNotice: t('permission.page.libraryPrivateNotice'),
      }}
    />
  );
});

LibraryPermission.displayName = 'LibraryPermission';

export default LibraryPermission;
