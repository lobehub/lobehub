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
    onContentChange,
    unsavedChangesGuard,
    style,
    ...editorProps
  }) => {
    const { t } = useTranslation(['file', 'ui']);

    const storeUpdater = createStoreUpdater(useDocumentStore);
    storeUpdater('activeDocumentId', documentId);
    storeUpdater('editor', editor);

    // Get document store actions
    const [onEditorInit, handleContentChangeStore, useFetchDocument, performSave, flushSave] =
      useDocumentStore((s) => [
        s.onEditorInit,
        s.handleContentChange,
        s.useFetchDocument,
        s.performSave,
        s.flushSave,
      ]);

    useSaveDocumentHotkey(flushSave);

    // Use SWR hook for document fetching (auto-initializes via onSuccess in DocumentStore)
    const { error } = useFetchDocument(documentId, { autoSave, editor, sourceType });

    // Check loading state via selector (document not yet in store)
    const isLoading = useDocumentStore(editorSelectors.isDocumentLoading(documentId));
    const isDirty = useDocumentStore(editorSelectors.isDirty(documentId));
    const shouldGuardUnsavedChanges = unsavedChangesGuard?.enabled ?? false;

    const handleAutoSaveBeforeLeave = useCallback(async () => {
      if (!shouldGuardUnsavedChanges) return true;

      handleContentChangeStore();
      await performSave(documentId);

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

    // 追踪已经为哪个 documentId 调用过 onEditorInit
    const initializedDocIdRef = useRef<string | null>(null);

    // 关键修复：如果 editor 已经初始化，需要主动调用 onEditorInit
    // 因为 onInit 回调只在 editor 首次初始化时触发
    useEffect(() => {
      // 避免重复调用：只在 documentId 变化且 editor 已初始化时调用
      if (
        editor &&
        isEditorInitialized &&
        !isLoading &&
        initializedDocIdRef.current !== documentId
      ) {
        const runId = ++initRunIdRef.current;
        initializedDocIdRef.current = documentId;

        // Lock content-change callback while hydrating document content into editor.
        contentChangeLockRef.current = true;

        void onEditorInit(editor).finally(() => {
          queueMicrotask(() => {
            if (initRunIdRef.current === runId) {
              contentChangeLockRef.current = false;
            }
          });
        });
      }
    }, [documentId, editor, isEditorInitialized, isLoading, onEditorInit]);

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
          onInit={onEditorInit}
          {...editorProps}
        />
      </>
    );
  },
);

DocumentIdMode.displayName = 'DocumentIdMode';

export default DocumentIdMode;
