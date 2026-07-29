'use client';

import { memo, useLayoutEffect } from 'react';
import { useLocation, useParams } from 'react-router';

import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import NProgress from '@/components/NProgress';
import ResourceManager from '@/features/ResourceManager';
import Container from '@/routes/(main)/resource/library/features/Container';

import { useInitFileCheck } from '../features/hooks/useInitFileCheck';
import { useKnowledgeBaseItem } from '../features/hooks/useKnowledgeItem';
import { useResourceManagerStore } from '../features/store';

const MainContent = memo(() => {
  const { id: knowledgeBaseId } = useParams<{ id: string }>();
  const location = useLocation();
  const setLibraryId = useResourceManagerStore((s) => s.setLibraryId);

  // Load knowledge base data
  const { data, isLoading, error, mutate } = useKnowledgeBaseItem(knowledgeBaseId || '');

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
  if (error && !data) return <AsyncError error={error} variant={'page'} onRetry={() => mutate()} />;

  if (!isLoading && !data) return <NotFound />;

  return <ResourceManager />;
});

MainContent.displayName = 'LibraryMainContent';

const LibraryPage = memo(() => {
  return (
    <>
      <NProgress />
      <Container>
        <MainContent />
      </Container>
    </>
  );
});

LibraryPage.displayName = 'LibraryPage';

export default LibraryPage;
