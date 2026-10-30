'use client';

import { memo, useLayoutEffect } from 'react';
import { Navigate, useLocation, useParams } from 'react-router';

import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import NProgress from '@/components/NProgress';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import Container from '@/features/ResourceLibrary/Container';
import ResourceManager from '@/features/ResourceManager';
import { useInitFileCheck } from '@/features/ResourceManager/hooks/useInitFileCheck';
import { useKnowledgeBaseItem } from '@/features/ResourceManager/hooks/useKnowledgeItem';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import {
  legacyLibraryItemRedirect,
  libraryFolderPath,
  rebaseLibraryPath,
} from '@/features/ResourceManager/utils/resourcePath';
import { useFileStore } from '@/store/file';
import { isForbiddenError } from '@/utils/forbiddenError';

import LibraryHero from './LibraryHero';

const MainContent = memo(() => {
  const {
    folderId,
    id: knowledgeBaseId,
    itemId,
    slug: legacyFolderSlug,
  } = useParams<{ folderId?: string; id: string; itemId?: string; slug?: string }>();
  const location = useLocation();
  const setLibraryId = useResourceManagerStore((s) => s.setLibraryId);

  // Folders used to open as `/resource/library/<id>/<folderSlug>`; resolve the
  // slug to the folder id the `folder/<folderId>` route carries now.
  const useFetchFolderBreadcrumb = useFileStore((s) => s.useFetchFolderBreadcrumb);
  const { data: legacyFolderChain, isLoading: isLegacyFolderLoading } =
    useFetchFolderBreadcrumb(legacyFolderSlug);

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
  useInitFileCheck(itemId);

  // Items used to open as `/resource/library/<id>?file=<itemId>`; keep old links working.
  const legacyRedirect =
    knowledgeBaseId && !itemId
      ? legacyLibraryItemRedirect(location.pathname, location.search, knowledgeBaseId)
      : null;
  if (legacyRedirect) return <Navigate replace to={legacyRedirect} />;

  if (knowledgeBaseId && legacyFolderSlug) {
    const legacyFolderId = legacyFolderChain.at(-1)?.id;
    if (legacyFolderId) {
      const pathname = rebaseLibraryPath(
        location.pathname,
        libraryFolderPath(knowledgeBaseId, legacyFolderId),
      );
      return <Navigate replace to={{ pathname, search: location.search }} />;
    }
    return isLegacyFolderLoading ? <RouteLoading /> : <NotFound />;
  }

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
  return <ResourceManager explorerHero={folderId ? undefined : <LibraryHero library={data} />} />;
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
