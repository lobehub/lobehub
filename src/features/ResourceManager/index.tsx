'use client';

import { createStaticStyles, Flexbox, useTheme } from '@lobehub/ui';
import { memo, type ReactNode, useCallback, useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router';

import DragUploadZone from '@/components/DragUploadZone';
import { PageEditor } from '@/features/PageEditor';
import { RESOURCE_HOME_PATH } from '@/features/ResourceHome/paths';
import { useLibraryItemBackPath } from '@/features/ResourceManager/hooks/useLibraryItemBackPath';
import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { LIBRARY_ITEM_PATH } from '@/features/ResourceManager/utils/resourcePath';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import dynamic from '@/libs/next/dynamic';
import { invalidateDocumentMutation } from '@/services/document/invalidation';
import { useFileStore } from '@/store/file';
import { documentSelectors } from '@/store/file/slices/document/selectors';
import { pageSelectors, usePageStore } from '@/store/page';

import FileEditor from './components/Editor';
import Explorer from './components/Explorer';
import { useTopLevelFileUpload } from './hooks/useTopLevelFileUpload';

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

/** A page or file opened over the Docs home by path. */
const OPENED_ITEM_PATH = /\/resource\/(?:file|page)\/[^/]+\/?$/;

export type ResourceManagerMode = 'editor' | 'explorer' | 'page';

/**
 * Manage resources. Can be from a certian library.
 *
 * Business component, no need be reusable.
 */
interface ResourceManagerProps {
  /**
   * Replaces the Explorer as the base content (used by the resource home
   * dashboard) while keeping the editor overlays, upload dock and drag zone.
   */
  content?: ReactNode;
  /** Shown above the Explorer list, e.g. the library cover at a library's root. */
  explorerHero?: ReactNode;
}

const ResourceManager = memo<ResourceManagerProps>(({ content, explorerHero }) => {
  const theme = useTheme();
  const [, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useWorkspaceAwareNavigate();
  const [mode, currentViewItemId, libraryId, setMode, setCurrentViewItemId] =
    useResourceManagerStore((s) => [
      s.mode,
      s.currentViewItemId,
      s.libraryId,
      s.setMode,
      s.setCurrentViewItemId,
    ]);

  const currentDocument = useFileStore(documentSelectors.getDocumentById(currentViewItemId));
  // The sidebar row the page was opened from already knows its title and emoji;
  // without it the header reads "Untitled" until the page fetch lands.
  const [listedTitle, listedEmoji] = usePageStore((s) => {
    const row = pageSelectors.getDocumentById(currentViewItemId)(s);
    return [row?.title, row?.metadata?.emoji as string | undefined] as const;
  });
  const useFetchDocumentDetail = useFileStore((s) => s.useFetchDocumentDetail);
  const { allowed: canUpload } = usePermission('create_content');
  const uploadTopLevel = useTopLevelFileUpload();

  const handleUploadFiles = useCallback(
    (files: File[]) => {
      if (!canUpload) return;
      void uploadTopLevel(files);
    },
    [canUpload, uploadTopLevel],
  );

  const cssVariables = useMemo<Record<string, string>>(
    () => ({
      '--editor-overlay-bg': theme.colorBgContainerSecondary,
    }),
    [theme.colorBgContainerSecondary],
  );

  // Keep the open item's document row in the replica. Deliberately not gated on
  // `mode`: on a cold `?file=` deep link the page/file decision itself needs the
  // row, so gating on it would wait for the very network the projection exists
  // to avoid. The view is read from the store, so a reload paints from the
  // persisted projection on the first frame and the network only confirms it.
  useFetchDocumentDetail(currentViewItemId);

  const isLibraryItemRoute = LIBRARY_ITEM_PATH.test(location.pathname);
  const libraryBackPath = useLibraryItemBackPath(
    libraryId,
    isLibraryItemRoute ? currentViewItemId : undefined,
  );

  const handleBack = () => {
    setMode('explorer');
    setCurrentViewItemId(undefined);
    // An item opened by path (`/resource/{file,page}/:id`) goes back to the Docs home.
    if (OPENED_ITEM_PATH.test(location.pathname)) {
      navigate(RESOURCE_HOME_PATH);
      return;
    }
    // An item opened inside a library (`/resource/library/:id/{docs,file}/:itemId`)
    // goes back to the folder that holds it.
    if (isLibraryItemRoute && libraryBackPath) {
      navigate(libraryBackPath);
      return;
    }
    // Remove the file query parameter from URL
    setSearchParams((prev) => {
      prev.delete('file');
      return prev;
    });
  };

  // The editor owns the write; refreshing readers must not issue another rename.
  const handleMetadataSaved = useCallback(() => {
    if (!currentViewItemId) return;
    void invalidateDocumentMutation({
      documentId: currentViewItemId,
      refreshDocumentEditor: false,
      refreshResources: true,
    });
  }, [currentViewItemId]);

  return (
    <>
      <DragUploadZone
        enabledFiles={canUpload}
        style={{ height: '100%' }}
        onUploadFiles={handleUploadFiles}
      >
        <Flexbox className={styles.container} height={'100%'} style={cssVariables}>
          {/* Explorer stays mounted to preserve its state, unless the caller
              swaps in its own base content (resource home dashboard) */}
          {content ?? <Explorer hero={explorerHero} />}

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
                emoji={(currentDocument?.metadata?.emoji as string | undefined) ?? listedEmoji}
                knowledgeBaseId={libraryId}
                pageId={currentViewItemId}
                title={currentDocument?.title ?? (listedTitle || undefined)}
                onBack={handleBack}
                onEmojiChange={handleMetadataSaved}
                onTitleChange={handleMetadataSaved}
              />
            </Flexbox>
          )}
        </Flexbox>
      </DragUploadZone>
      <ChunkDrawer />
    </>
  );
});

export default ResourceManager;
