'use client';

import { Flexbox } from '@lobehub/ui';
import { cssVar, useTheme } from 'antd-style';
import dynamic from 'next/dynamic';
import { memo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import { PageEditor } from '@/features/PageEditor';
import { documentService } from '@/services/document';
import { useFileStore } from '@/store/file';
import { documentSelectors } from '@/store/file/slices/document/selectors';

import Editor from './components/Editor';
import Explorer from './components/Explorer';
import UploadDock from './components/UploadDock';

const ChunkDrawer = dynamic(() => import('./components/ChunkDrawer'), { ssr: false });

export type ResouceManagerMode = 'editor' | 'explorer' | 'page';

/**
 * Manage resources. Can be from a certian library.
 *
 * Business component, no need be reusable.
 */
const ResourceManager = memo(() => {
  const theme = useTheme();
  const [, setSearchParams] = useSearchParams();
  const [mode, currentViewItemId, libraryId, setMode, setCurrentViewItemId] =
    useResourceManagerStore((s) => [
      s.mode,
      s.currentViewItemId,
      s.libraryId,
      s.setMode,
      s.setCurrentViewItemId,
    ]);

  const currentDocument = useFileStore(documentSelectors.getDocumentById(currentViewItemId));

  // Fetch specific document when switching to page mode if not already loaded
  useEffect(() => {
    if (mode === 'page' && currentViewItemId && !currentDocument) {
      // Document not in store, fetch it individually
      documentService.getDocumentById(currentViewItemId).then((doc) => {
        if (doc) {
          // Add the document to the store's documents array
          useFileStore.setState((state) => ({
            documents: [...state.documents, doc as any],
          }));
        }
      });
    }
  }, [mode, currentViewItemId, currentDocument]);

  const handleBack = () => {
    setMode('explorer');
    setCurrentViewItemId(undefined);
    // Remove the file query parameter from URL
    setSearchParams((prev) => {
      prev.delete('file');
      return prev;
    });
  };

  return (
    <>
      <Flexbox height={'100%'} style={{ position: 'relative' }}>
        {/* Explorer is always rendered to preserve its state */}
        <Explorer />

        {/* Editor overlay */}
        {mode === 'editor' && (
          <Flexbox
            height={'100%'}
            style={{
              backgroundColor: theme.colorBgContainerSecondary,
              inset: 0,
              position: 'absolute',
              zIndex: 1,
            }}
            width={'100%'}
          >
            <Editor />
          </Flexbox>
        )}

        {/* PageEditor overlay */}
        {mode === 'page' && (
          <Flexbox
            height={'100%'}
            style={{
              backgroundColor: cssVar.colorBgLayout,
              inset: 0,
              position: 'absolute',
              zIndex: 1,
            }}
            width={'100%'}
          >
            <PageEditor
              knowledgeBaseId={libraryId}
              onBack={handleBack}
              pageId={currentViewItemId}
            />
          </Flexbox>
        )}
      </Flexbox>
      <UploadDock />
      <ChunkDrawer />
    </>
  );
});

export default ResourceManager;
