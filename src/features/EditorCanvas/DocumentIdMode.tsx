'use client';

import { type IEditor } from '@lobehub/editor';
import { Alert, Skeleton } from '@lobehub/ui';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { createStoreUpdater } from 'zustand-utils';

import { useSaveDocumentHotkey } from '@/hooks/useHotkeys';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';

import { type EditorCanvasProps } from './EditorCanvas';
import InternalEditor from './InternalEditor';
import UnsavedChangesGuard from './UnsavedChangesGuard';

/**
 * Loading skeleton for the editor
 */
const EditorSkeleton = memo(() => (
  <div style={{ paddingBlock: 24 }}>
    <Skeleton active paragraph={{ rows: 8 }} />
  </div>
));

/**
 * Error display for fetch failures
 */
const EditorError = memo<{ error: Error }>(({ error }) => {
  const { t } = useTranslation('file');

  return (
    <Alert
      showIcon
      description={error.message || t('pageEditor.loadError', 'Failed to load document')}
      style={{ margin: 16 }}
      title={t('pageEditor.error', 'Error')}
      type="error"
    />
  );
});

export interface DocumentIdModeProps extends EditorCanvasProps {
  documentId: string;
  editor: IEditor | undefined;
}

/**
 * EditorCanvas with documentId mode - handles data fetching internally
 */
const DocumentIdMode = memo<DocumentIdModeProps>(
  ({
    editor,
    documentId,
    autoSave = true,
    sourceType = 'page',
    topicId,
    onContentChange,
    onInit,
    unsavedChangesGuard,
    style,
    ...editorProps
  }) => {
    const { t } = useTranslation(['file', 'ui']);

    const storeUpdater = createStoreUpdater(useDocumentStore);
    storeUpdater('activeDocumentId', documentId);
    storeUpdater('editor', editor);

    // Get document store actions
    const [onEditorInit, handleContentChangeStore, useFetchDocument, performSave] =
      useDocumentStore((s) => [
        s.onEditorInit,
        s.handleContentChange,
        s.useFetchDocument,
        s.performSave,
      ]);

    const handleManualSave = useCallback(async () => {
      handleContentChangeStore();
      await performSave(documentId, undefined, { saveSource: 'manual' });
    }, [documentId, handleContentChangeStore, performSave]);

    useSaveDocumentHotkey(handleManualSave);

    const handleEditorInit = useCallback(
      (editorInstance: IEditor) => {
        void onEditorInit(editorInstance).finally(() => {
          onInit?.(editorInstance);
        });
      },
      [onEditorInit, onInit],
    );

    // Use SWR hook for document fetching (auto-initializes via onSuccess in DocumentStore)
    const { data: remoteDocument, error } = useFetchDocument(documentId, {
      autoSave,
      editor,
      sourceType,
      topicId,
    });
    const remoteDocumentUpdatedAt = remoteDocument?.updatedAt;
    const remoteDocumentVersion = remoteDocumentUpdatedAt?.toISOString();

    // Check loading state via selector (document not yet in store)
    const isLoading = useDocumentStore(editorSelectors.isDocumentLoading(documentId));
    const isDirty = useDocumentStore(editorSelectors.isDirty(documentId));
    const shouldGuardUnsavedChanges = unsavedChangesGuard?.enabled ?? false;

    const handleAutoSaveBeforeLeave = useCallback(async () => {
      if (!shouldGuardUnsavedChanges) return true;

      handleContentChangeStore();
      await performSave(documentId, undefined, { saveSource: 'system' });

      const latestDocument = useDocumentStore.getState().documents[documentId];
      return latestDocument ? !latestDocument.isDirty : true;
    }, [documentId, handleContentChangeStore, performSave, shouldGuardUnsavedChanges]);

    const unsavedGuardNode = (
      <UnsavedChangesGuard
        isDirty={shouldGuardUnsavedChanges && isDirty}
        message={unsavedChangesGuard?.message || t('form.unsavedWarning', { ns: 'ui' })}
        title={unsavedChangesGuard?.title || t('form.unsavedChanges', { ns: 'ui' })}
        onAutoSave={handleAutoSaveBeforeLeave}
      />
    );

    // Handle content change
    const handleChange = () => {
      handleContentChangeStore();
      onContentChange?.();
    };

    const isEditorInitialized = !!editor?.getLexicalEditor();
    const contentChangeLockRef = useRef(false);
    const initRunIdRef = useRef(0);

    // Track which documentId has already had onEditorInit called
    const initializedDocIdRef = useRef<string | null>(null);
    const hydratedVersionRef = useRef<string | undefined>(undefined);

    // Critical fix: if the editor is already initialized, we need to manually call onEditorInit
    // because the onInit callback only fires on the first editor initialization
    useEffect(() => {
      // Avoid duplicate calls: only invoke when documentId changes and editor is initialized
      if (
        editor &&
        isEditorInitialized &&
        !isLoading &&
        initializedDocIdRef.current !== documentId
      ) {
        const runId = ++initRunIdRef.current;
        initializedDocIdRef.current = documentId;
        hydratedVersionRef.current = remoteDocumentVersion;

        // Lock content-change callback while hydrating document content into editor.
        contentChangeLockRef.current = true;

        void onEditorInit(editor).finally(() => {
          onInit?.(editor);
          queueMicrotask(() => {
            if (initRunIdRef.current === runId) {
              contentChangeLockRef.current = false;
            }
          });
        });
      }
    }, [
      documentId,
      editor,
      isEditorInitialized,
      isLoading,
      onEditorInit,
      onInit,
      remoteDocumentVersion,
    ]);

    useEffect(() => {
      if (!editor || !isEditorInitialized || isLoading || !remoteDocumentVersion) return;
      if (initializedDocIdRef.current !== documentId) return;
      if (hydratedVersionRef.current === remoteDocumentVersion) return;
      if (isDirty) return;

      const runId = ++initRunIdRef.current;
      hydratedVersionRef.current = remoteDocumentVersion;
      contentChangeLockRef.current = true;

      void onEditorInit(editor).finally(() => {
        onInit?.(editor);
        queueMicrotask(() => {
          if (initRunIdRef.current === runId) {
            contentChangeLockRef.current = false;
          }
        });
      });
    }, [
      documentId,
      editor,
      isDirty,
      isEditorInitialized,
      isLoading,
      onEditorInit,
      onInit,
      remoteDocumentVersion,
    ]);

    // Show loading state
    if (isLoading) {
      return (
        <>
          {unsavedGuardNode}
          <EditorSkeleton />
        </>
      );
    }

    if (!editor) return unsavedGuardNode;

    return (
      <>
        {unsavedGuardNode}
        {error && <EditorError error={error as Error} />}
        <InternalEditor
          contentChangeLockRef={contentChangeLockRef}
          editor={editor}
          placeholder={editorProps.placeholder || t('pageEditor.editorPlaceholder')}
          style={style}
          onContentChange={handleChange}
          onInit={handleEditorInit}
          {...editorProps}
        />
      </>
    );
  },
);

DocumentIdMode.displayName = 'DocumentIdMode';

export default DocumentIdMode;
