'use client';

import { App } from 'antd';
import { memo, useEffect } from 'react';
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';

import KnowledgeBaseDetailPage from './routes/KnowledgeBaseDetail';
import KnowledgeBasesListPage from './routes/KnowledgeBasesList';
import KnowledgeHomePage from './routes/KnowledgeHome';

// Get initial path from URL
const getInitialPath = () => {
  if (typeof window === 'undefined') return '/';
  const fullPath = window.location.pathname;
  const searchParams = window.location.search;
  const knowledgeIndex = fullPath.indexOf('/knowledge');

  if (knowledgeIndex !== -1) {
    const pathAfterKnowledge = fullPath.slice(knowledgeIndex + '/knowledge'.length) || '/';
    return pathAfterKnowledge + searchParams;
  }
  return '/';
};

// Helper component to sync URL with MemoryRouter
const UrlSynchronizer = () => {
  const location = useLocation();

  // Update browser URL when location changes
  useEffect(() => {
    const newUrl = `/knowledge${location.pathname}${location.search}`;
    if (window.location.pathname + window.location.search !== newUrl) {
      window.history.replaceState({}, '', newUrl);
    }
  }, [location.pathname, location.search]);

  return null;
};

/**
 * Main Knowledge Router component with MemoryRouter
 * This serves as the entry point for all knowledge-related routes
 * Uses MemoryRouter with URL synchronization to support query parameters like ?file=[id]
 *
 * Route structure:
 * - / → Knowledge home (file list with categories)
 * - /bases → Knowledge bases list
 * - /bases/:id → Knowledge base detail (file list for specific base)
 */
const KnowledgeRouter = memo(() => {
  return (
    <App style={{ display: 'flex', flex: 1, height: '100%' }}>
      <MemoryRouter initialEntries={[getInitialPath()]} initialIndex={0}>
        <UrlSynchronizer />
        <Routes>
          {/* Knowledge home - file list page */}
          <Route element={<KnowledgeHomePage />} path="/" />

          {/* Knowledge bases routes */}
          <Route element={<KnowledgeBasesListPage />} path="/bases" />
          <Route element={<KnowledgeBaseDetailPage />} path="/bases/:id" />

          {/* Fallback */}
          <Route element={<Navigate replace to="/" />} path="*" />
        </Routes>
      </MemoryRouter>
    </App>
  );
});

KnowledgeRouter.displayName = 'KnowledgeRouter';

export default KnowledgeRouter;
