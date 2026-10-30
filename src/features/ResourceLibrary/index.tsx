'use client';

import { memo, useLayoutEffect } from 'react';
import { useLocation, useParams } from 'react-router';

import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import NProgress from '@/components/NProgress';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import Container from '@/features/ResourceLibrary/Container';
import ResourceManager from '@/features/ResourceManager';
import { useInitFileCheck } from '@/features/ResourceManager/hooks/useInitFileCheck';
import { useKnowledgeBaseItem } from '@/features/ResourceManager/hooks/useKnowledgeItem';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { isForbiddenError } from '@/utils/forbiddenError';

import LibraryHero from './LibraryHero';

const MainContent = memo(() => {
  const { id: knowledgeBaseId, slug } = useParams<{ id: string; slug?: string }>();
  const location = useLocation();
  const setLibraryId = useResourceManagerStore((s) => s.setLibraryId);

  // Load knowledge base data
  const { data, isLoading, error, mutate } = useKnowledgeBaseItem(knowledgeBaseId || '');

  // Restricted KBs (resource-permission `use` level) are hidden from the
  // sidebar, so a 403 here means a hand-typed / stale / shared URL. Stay on
  // the page and say why via the shared 403 copy — no retry button, since
  // retrying can never succeed.
  const isRestricted = !!error && isForbiddenError(error);

  // Sync libraryId from URL params using useLayoutEffect
  // useLayoutEffect runs synchronously before browser paint, ensuring state is set
  // before Explorer component renders and computes query parameters
  // IMPORTANT: Only depend on knowledgeBaseId and location.pathname, NOT currentLibraryId to avoid feedback loop
  useLayoutEffect(() => {
    const isOnLibraryRoute = location.pathname.includes('/library/');
    if (isOnLibraryRoute) {
      setLibraryId(knowledgeBaseId);
    }
  }, [knowledgeBaseId, setLibraryId, location.pathname]);

  // Sync file view mode from URL
  useInitFileCheck();

  // A network / 500 on the KB fetch is NOT "this library doesn't exist" (Read §1.1):
  // branch a transient error to a reload state that keeps the URL, and reserve the
  // terminal 404 for a genuinely resolved-null (deleted / never-existed) record.
  if (error && !data)
    return (
      <AsyncError
        error={error}
        variant={'page'}
        onRetry={isRestricted ? undefined : () => mutate()}
      />
    );

  if (isLoading) return <RouteLoading />;

  if (!data) return <NotFound />;

  // The cover header belongs to the library's root, not to every folder in it.
  return <ResourceManager explorerHero={slug ? undefined : <LibraryHero library={data} />} />;
});

MainContent.displayName = 'LibraryMainContent';

const LibraryPage = () => {
  return (
    <>
      <NProgress />
      <Container>
        <MainContent />
      </Container>
    </>
  );
};

export default LibraryPage;
