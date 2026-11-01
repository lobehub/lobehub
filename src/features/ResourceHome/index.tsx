'use client';

import { memo, useLayoutEffect } from 'react';
import { useLocation, useSearchParams } from 'react-router';

import ResourceManager from '@/features/ResourceManager';
import { useInitFileCheck } from '@/features/ResourceManager/hooks/useInitFileCheck';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import WorkGallery from '@/features/WorkGallery';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { FilesTabs } from '@/types/files';

import HomeDashboard from './Home';
import { resolveResourceRoute } from './paths';

const ResourceHomePage = memo(() => {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  const [setCategory, setLibraryId] = useResourceManagerStore((s) => [
    s.setCategory,
    s.setLibraryId,
  ]);

  const view = resolveResourceRoute(location.pathname, searchParams);
  const redirectTo = view.kind === 'redirect' ? view.to : null;
  // The bare /resource route is the home dashboard (an opened page or file is
  // overlaid on it); the drive lists files by category under /resource/drive.
  const categoryParam = view.kind === 'drive' ? view.category : FilesTabs.Home;

  useLayoutEffect(() => {
    if (redirectTo) navigate(redirectTo, { replace: true });
  }, [redirectTo, navigate]);

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

  // Sync the open item from the URL: `/resource/{file,page}/:id` paths, or
  // the drive explorer's own `?file=` preview.
  useInitFileCheck(view.kind === 'file' || view.kind === 'page' ? view.id : null);

  if (view.kind === 'works') return <WorkGallery galleryKey={view.galleryKey} />;

  return <ResourceManager content={view.kind === 'drive' ? undefined : <HomeDashboard />} />;
});

ResourceHomePage.displayName = 'ResourceHomePage';

export default ResourceHomePage;
