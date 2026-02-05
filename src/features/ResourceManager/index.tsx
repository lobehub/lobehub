'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, useTheme } from 'antd-style';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useResourceManagerStore } from '@/app/[variants]/(main)/resource/features/store';
import DragUploadZone from '@/components/DragUploadZone';
import { PageEditor } from '@/features/PageEditor';
import dynamic from '@/libs/next/dynamic';
import { documentService } from '@/services/document';
import { useFileStore } from '@/store/file';
import { documentSelectors } from '@/store/file/slices/document/selectors';

import FileEditor from './components/Editor';
import Explorer from './components/Explorer';
import UploadDock from './components/UploadDock';

const ChunkDrawer = dynamic(() => import('./components/ChunkDrawer'), { ssr: false });

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    container: css`
      position: relative;
      overflow: hidden;
    `,
    editorOverlay: css`
      position: absolute;
      z-index: 1;
      inset: 0;

      width: 100%;
      height: 100%;

      background-color: var(--editor-overlay-bg, ${cssVar.colorBgContainer});
    `,
    pageEditorOverlay: css`
      position: absolute;
      z-index: 1;
      inset: 0;

      width: 100%;
      height: 100%;

      background-color: ${cssVar.colorBgLayout};
    `,
  };
});

export type ResourceManagerMode = 'editor' | 'explorer' | 'page';

/**
 * Manage resources. Can be from a certian library.
 *
 * Business component, no need be reusable.
 */
const ResourceManager = memo(() => {
  const theme = useTheme();
  const [, setSearchParams] = useSearchParams();
  const [mode, currentViewItemId, libraryId, currentFolderId, setMode, setCurrentViewItemId] =
    useResourceManagerStore((s) => [
      s.mode,
      s.currentViewItemId,
      s.libraryId,
      s.currentFolderId,
      s.setMode,
      s.setCurrentViewItemId,
    ]);

  const currentDocument = useFileStore(documentSelectors.getDocumentById(currentViewItemId));
  const pushDockFileList = useFileStore((s) => s.pushDockFileList);
  const updateDocumentOptimistically = useFileStore((s) => s.updateDocumentOptimistically);

  const handleUploadFiles = useCallback(
    (files: File[]) => pushDockFileList(files, libraryId, currentFolderId ?? undefined),
    [currentFolderId, libraryId, pushDockFileList],
  );

  const cssVariables = useMemo<Record<string, string>>(
    () => ({
      '--editor-overlay-bg': theme.colorBgContainerSecondary,
    }),
    [theme.colorBgContainerSecondary],
  );

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
    // Reset document title to default
    document.title = BRANDING_NAME;
  };

  // Optimistic update handlers for page title and emoji
  const handleTitleChange = useCallback(
    (newTitle: string) => {
      if (currentViewItemId) {
        updateDocumentOptimistically(currentViewItemId, { title: newTitle });
      }
    },
    [currentViewItemId, updateDocumentOptimistically],
  );

  const handleEmojiChange = useCallback(
    (newEmoji: string | undefined) => {
      if (currentViewItemId) {
        updateDocumentOptimistically(currentViewItemId, {
          metadata: { ...currentDocument?.metadata, emoji: newEmoji },
        });
      }
    },
    [currentViewItemId, currentDocument?.metadata, updateDocumentOptimistically],
  );

  return (
    <>
      <DragUploadZone enabledFiles style={{ height: '100%' }} onUploadFiles={handleUploadFiles}>
        <Flexbox className={styles.container} height={'100%'} style={cssVariables}>
          {/* Explorer is always rendered to preserve its state */}
          <Explorer />

          {/* Editor overlay */}
          {mode === 'editor' && (
            <Flexbox className={styles.editorOverlay}>
              <FileEditor onBack={handleBack} />
            </Flexbox>
          )}

          {/* PageEditor overlay */}
          {mode === 'page' && (
            <Flexbox className={styles.pageEditorOverlay}>
              <PageEditor
                emoji={currentDocument?.metadata?.emoji as string | undefined}
                knowledgeBaseId={libraryId}
                pageId={currentViewItemId}
                title={currentDocument?.title}
                onBack={handleBack}
                onEmojiChange={handleEmojiChange}
                onTitleChange={handleTitleChange}
              />
            </Flexbox>
          )}
        </Flexbox>
      </DragUploadZone>
      <UploadDock />
      <ChunkDrawer />
    </>
  );
});

export default ResourceManager;
