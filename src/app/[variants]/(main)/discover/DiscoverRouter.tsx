'use client';

import { memo, useEffect } from 'react';
import { useMediaQuery } from 'react-responsive';
import { MemoryRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import DetailLayout from './(detail)/_layout/DetailLayout';
import AssistantDetailPage from './(detail)/assistant/AssistantDetailPage';
import McpDetailPage from './(detail)/mcp/McpDetailPage';
import ModelDetailPage from './(detail)/model/ModelDetailPage';
import ProviderDetailPage from './(detail)/provider/ProviderDetailPage';
import HomePage from './(list)/(home)/HomePage';
import ListLayout from './(list)/_layout/ListLayout';
import AssistantLayout from './(list)/assistant/AssistantLayout';
import AssistantPage from './(list)/assistant/AssistantPage';
import McpLayout from './(list)/mcp/McpLayout';
import McpPage from './(list)/mcp/McpPage';
import ModelLayout from './(list)/model/ModelLayout';
import ModelPage from './(list)/model/ModelPage';
import ProviderPage from './(list)/provider/ProviderPage';
import DiscoverLayout from './_layout/DiscoverLayout';

// Get initial path from URL
const getInitialPath = () => {
  if (typeof window === 'undefined') return '/';
  const fullPath = window.location.pathname;
  const searchParams = window.location.search;
  const discoverIndex = fullPath.indexOf('/discover');

  if (discoverIndex !== -1) {
    const pathAfterDiscover = fullPath.slice(discoverIndex + '/discover'.length) || '/';
    return pathAfterDiscover + searchParams;
  }
  return '/';
};

// Helper component to sync URL with MemoryRouter
const UrlSynchronizer = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // Sync initial URL
  useEffect(() => {
    const fullPath = window.location.pathname;
    const searchParams = window.location.search;
    const discoverIndex = fullPath.indexOf('/discover');

    if (discoverIndex !== -1) {
      const pathAfterDiscover = fullPath.slice(discoverIndex + '/discover'.length) || '/';
      const targetPath = pathAfterDiscover + searchParams;

      if (location.pathname + location.search !== targetPath) {
        navigate(targetPath, { replace: true });
      }
    }
  }, []);

  // Update browser URL when location changes
  useEffect(() => {
    const normalizedPath = location.pathname === '/' ? '' : location.pathname;
    const newUrl = `/discover${normalizedPath}${location.search}`;
    if (window.location.pathname + window.location.search !== newUrl) {
      window.history.replaceState({}, '', newUrl);
    }
  }, [location.pathname, location.search]);

  return null;
};

const DiscoverRouter = memo(() => {
  const mobile = useMediaQuery({ maxWidth: 768 });

  return (
    <MemoryRouter initialEntries={[getInitialPath()]} initialIndex={0}>
      <UrlSynchronizer />
      <DiscoverLayout mobile={mobile}>
        <Routes>
          {/* List routes with ListLayout */}
          <Route
            element={
              <ListLayout mobile={mobile}>
                <HomePage mobile={mobile} />
              </ListLayout>
            }
            path="/"
          />
          <Route
            element={
              <ListLayout mobile={mobile}>
                <AssistantLayout mobile={mobile}>
                  <AssistantPage mobile={mobile} />
                </AssistantLayout>
              </ListLayout>
            }
            path="/assistant"
          />
          <Route
            element={
              <ListLayout mobile={mobile}>
                <ModelLayout mobile={mobile}>
                  <ModelPage mobile={mobile} />
                </ModelLayout>
              </ListLayout>
            }
            path="/model"
          />
          <Route
            element={
              <ListLayout mobile={mobile}>
                <ProviderPage mobile={mobile} />
              </ListLayout>
            }
            path="/provider"
          />
          <Route
            element={
              <ListLayout mobile={mobile}>
                <McpLayout mobile={mobile}>
                  <McpPage mobile={mobile} />
                </McpLayout>
              </ListLayout>
            }
            path="/mcp"
          />

          {/* Detail routes with DetailLayout */}
          <Route
            element={
              <DetailLayout mobile={mobile}>
                <AssistantDetailPage mobile={mobile} />
              </DetailLayout>
            }
            path="/assistant/*"
          />
          <Route
            element={
              <DetailLayout mobile={mobile}>
                <ModelDetailPage mobile={mobile} />
              </DetailLayout>
            }
            path="/model/*"
          />
          <Route
            element={
              <DetailLayout mobile={mobile}>
                <ProviderDetailPage mobile={mobile} />
              </DetailLayout>
            }
            path="/provider/*"
          />
          <Route
            element={
              <DetailLayout mobile={mobile}>
                <McpDetailPage mobile={mobile} />
              </DetailLayout>
            }
            path="/mcp/*"
          />

          {/* Fallback */}
          <Route element={<Navigate replace to="/" />} path="*" />
        </Routes>
      </DiscoverLayout>
    </MemoryRouter>
  );
});

DiscoverRouter.displayName = 'DiscoverRouter';

export default DiscoverRouter;
