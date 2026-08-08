'use client';

import { memo, useLayoutEffect } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';

import ResourceManager from '@/features/ResourceManager';
import { useInitFileCheck } from '@/features/ResourceManager/hooks/useInitFileCheck';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import WorkGallery from '@/features/WorkGallery';
import { parseWorkGalleryKey } from '@/features/WorkGallery/const';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { FilesTabs } from '@/types/files';

import HomeDashboard from './Home';

/** Categories that own a path segment: /resource/all, /resource/documents, … */
export const PATH_CATEGORIES = new Set<string>([
  FilesTabs.All,
  FilesTabs.Audios,
  FilesTabs.Documents,
  FilesTabs.Files,
  FilesTabs.Images,
  FilesTabs.Videos,
]);

/** Path segment of the cross-topic Work gallery: /resource/works */
export const WORKS_PATH_SEGMENT = 'works';

const ResourceHomePage = memo(() => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const params = useParams<{ category?: string }>();
  const navigate = useWorkspaceAwareNavigate();
  const [setCategory, setLibraryId] = useResourceManagerStore((s) => [
    s.setCategory,
    s.setLibraryId,
  ]);

  const pathCategory = params.category;
  const isValidPathCategory = !!pathCategory && PATH_CATEGORIES.has(pathCategory);
  // The Work gallery owns its own path segment; `?works=<key>` narrows it
  // (task / document / linear / github), defaulting to the combined view.
  const isWorksPath = pathCategory === WORKS_PATH_SEGMENT;
  const worksKey = isWorksPath ? (parseWorkGalleryKey(searchParams.get('works')) ?? 'all') : null;
  // The bare /resource route is the library home dashboard; explorer views
  // live under /resource/<category> (the all-files list at /resource/all).
  const categoryParam = isValidPathCategory ? (pathCategory as FilesTabs) : FilesTabs.Home;

  // Legacy URLs used `?category=<x>` / `?works=<key>` on the bare /resource
  // route; canonical forms are now /resource/<x> and /resource/works.
  const legacyCategory = searchParams.get('category');
  const legacyWorksKey = isWorksPath ? null : parseWorkGalleryKey(searchParams.get('works'));
  const isInvalidPath = !!pathCategory && !isValidPathCategory && !isWorksPath;

  useLayoutEffect(() => {
    if (legacyWorksKey) {
      navigate(
        legacyWorksKey === 'all' ? '/resource/works' : `/resource/works?works=${legacyWorksKey}`,
        { replace: true },
      );
      return;
    }
    if (legacyCategory) {
      const target = PATH_CATEGORIES.has(legacyCategory)
        ? `/resource/${legacyCategory}`
        : '/resource';
      navigate(target, { replace: true });
      return;
    }
    if (isInvalidPath) navigate('/resource', { replace: true });
  }, [legacyWorksKey, legacyCategory, isInvalidPath, navigate]);

  // Clear libraryId when on home route using useLayoutEffect
  // useLayoutEffect runs synchronously before browser paint, ensuring state is cleared
  // before child components' useEffects run, while avoiding React's setState-in-render error
  // IMPORTANT: Only depend on location.pathname, NOT currentLibraryId to avoid feedback loop
  // When location changes to /resource, clear libraryId
  // Don't clear when location is /library/* (even if this component is still mounted)
  useLayoutEffect(() => {
    const isOnHomeRoute =
      location.pathname === '/resource' || !location.pathname.includes('/library/');
    if (isOnHomeRoute) {
      setLibraryId(undefined);
    }
  }, [setLibraryId, location.pathname]);

  // Sync category from URL using useLayoutEffect
  // IMPORTANT: Only sync if we're actually on the home route (not transitioning to library)
  useLayoutEffect(() => {
    const isOnHomeRoute =
      location.pathname === '/resource' || !location.pathname.includes('/library/');
    if (isOnHomeRoute) {
      setCategory(categoryParam);
    }
  }, [categoryParam, setCategory, location.pathname]);

  // Sync file view mode from URL
  useInitFileCheck();

  if (worksKey) return <WorkGallery galleryKey={worksKey} />;

  return <ResourceManager content={isValidPathCategory ? undefined : <HomeDashboard />} />;
});

ResourceHomePage.displayName = 'ResourceHomePage';

export default ResourceHomePage;
