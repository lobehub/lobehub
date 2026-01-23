'use client';

import { type IEditor } from '@lobehub/editor';
import { Alert, Skeleton } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { createStoreUpdater } from 'zustand-utils';

import { useSaveDocumentHotkey } from '@/hooks/useHotkeys';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';

import type { EditorCanvasProps } from './EditorCanvas';
import InternalEditor from './InternalEditor';

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
      description={error.message || t('pageEditor.loadError', 'Failed to load document')}
      showIcon
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
    style,
    ...editorProps
  }) => {
    const { t } = useTranslation('file');

    const storeUpdater = createStoreUpdater(useDocumentStore);
    storeUpdater('activeDocumentId', documentId);
    storeUpdater('editor', editor);

    // Get document store actions
    const [onEditorInit, handleContentChangeStore, useFetchDocument, flushSave] = useDocumentStore(
      (s) => [s.onEditorInit, s.handleContentChange, s.useFetchDocument, s.flushSave],
    );

    useSaveDocumentHotkey(flushSave);

    // Use SWR hook for document fetching (auto-initializes via onSuccess in DocumentStore)
    const { error } = useFetchDocument(documentId, { autoSave, editor, sourceType });

    // Check loading state via selector (document not yet in store)
    const isLoading = useDocumentStore(editorSelectors.isDocumentLoading(documentId));

    // Handle content change
    const handleChange = () => {
      handleContentChangeStore();
      onContentChange?.();
    };

    // Show loading state
    if (isLoading) {
      return <EditorSkeleton />;
    }

    if (!editor) return null;

    return (
      <>
        {error && <EditorError error={error as Error} />}
        <InternalEditor
          editor={editor}
          onContentChange={handleChange}
          onInit={onEditorInit}
          placeholder={editorProps.placeholder || t('pageEditor.editorPlaceholder')}
          style={style}
          {...editorProps}
        />
      </>
    );
  },
);

DocumentIdMode.displayName = 'DocumentIdMode';

export default DocumentIdMode;
