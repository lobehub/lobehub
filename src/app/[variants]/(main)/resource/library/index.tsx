'use client';

import { memo, useEffect, useLayoutEffect } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';

import Container from '@/app/[variants]/(main)/resource/library/features/Container';
import NProgress from '@/components/NProgress';
import ResourceManager from '@/features/ResourceManager';
import { documentSelectors, useFileStore } from '@/store/file';

import { useKnowledgeBaseItem } from '../features/hooks/useKnowledgeItem';
import { useResourceManagerStore } from '../features/store';

const MainContent = memo(() => {
  const { id: knowledgeBaseId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [setMode, setCurrentViewItemId, setLibraryId] = useResourceManagerStore((s) => [
    s.setMode,
    s.setCurrentViewItemId,
    s.setLibraryId,
  ]);

  const fileId = searchParams.get('file');

  // Fetch file or document details to determine correct mode
  const useFetchKnowledgeItem = useFileStore((s) => s.useFetchKnowledgeItem);
  const { data: fileData } = useFetchKnowledgeItem(fileId || undefined);
  const documentData = useFileStore(documentSelectors.getDocumentById(fileId || undefined));

  // Load knowledge base data
  useKnowledgeBaseItem(knowledgeBaseId || '');

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
  useEffect(() => {
    if (fileId) {
      setCurrentViewItemId(fileId);

      // Only determine mode when we have file data loaded
      // This prevents incorrect mode being set while data is loading
      if (fileData || documentData) {
        // Check if it's a PDF file - check both file data and document data
        const isPDF =
          fileData?.fileType?.toLowerCase() === 'pdf' ||
          fileData?.fileType?.toLowerCase() === 'application/pdf' ||
          fileData?.name?.toLowerCase().endsWith('.pdf') ||
          documentData?.fileType?.toLowerCase() === 'pdf' ||
          documentData?.fileType?.toLowerCase() === 'application/pdf' ||
          documentData?.filename?.toLowerCase().endsWith('.pdf');

        // Check if it's a page/document
        const isPage =
          !isPDF &&
          (fileData?.sourceType === 'document' ||
            fileData?.fileType === 'custom/document' ||
            !!documentData);

        // Determine mode based on file type
        if (isPDF) {
          // PDF files should always use editor mode for PDF viewer
          setMode('editor');
        } else if (isPage) {
          setMode('page');
        } else {
          setMode('editor');
        }
      }
    } else {
      // Reset to explorer mode when no file is selected
      setMode('explorer');
      setCurrentViewItemId(undefined);
    }
  }, [fileId, fileData, documentData, setCurrentViewItemId, setMode]);

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
