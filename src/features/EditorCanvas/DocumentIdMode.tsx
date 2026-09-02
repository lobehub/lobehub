'use client';

import { type IEditor } from '@lobehub/editor';
import { Skeleton } from '@lobehub/ui';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { createStoreUpdater } from 'zustand-utils';

import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import { useSaveDocumentHotkey } from '@/hooks/useHotkeys';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';

import { type EditorCanvasProps } from './EditorCanvas';
import InternalEditor from './InternalEditor';
import UnsavedChangesGuard from './UnsavedChangesGuard';

/**
 * Loading skeleton for the editor
 */
const EditorSkeleton = () => (
  <div style={{ paddingBlock: 24 }}>
    <Skeleton active paragraph={{ rows: 8 }} />
  </div>
);

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
    collaborationEnabled = false,
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

    // Use SWR hook for document fetching (auto-initializes via onSuccess in DocumentStore)
    const {
      data: remoteDocument,
      error,
      hasFreshData,
      isLoading: isFetchingDocument,
      mutate,
    } = useFetchDocument(documentId, {
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
      // A lock CONFLICT is not a network failure — surface the real reason
      // instead of the generic "check your connection" toast.
      if (latestDocument?.saveBlockedByLock)
        throw new Error(t('pageEditor.editMode.lockedBySomeone'));
      return latestDocument ? !latestDocument.isDirty : true;
    }, [documentId, handleContentChangeStore, performSave, shouldGuardUnsavedChanges, t]);

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
    const isWaitingForFreshCollaborationSnapshot =
      collaborationEnabled && initializedDocIdRef.current !== documentId && !hasFreshData;

    const handleEditorInit = useCallback(
      (editorInstance: IEditor) => {
        // InternalEditor and the already-created-editor fallback can fire in
        // the same commit. Claim this document/version synchronously so the
        // server snapshot is applied exactly once.
        if (
          initializedDocIdRef.current === documentId &&
          hydratedVersionRef.current === remoteDocumentVersion
        ) {
          return Promise.resolve();
        }

        const runId = ++initRunIdRef.current;
        initializedDocIdRef.current = documentId;
        hydratedVersionRef.current = remoteDocumentVersion;
        contentChangeLockRef.current = true;

        return onEditorInit(editorInstance).finally(() => {
          onInit?.(editorInstance);
          queueMicrotask(() => {
            if (initRunIdRef.current === runId) {
              contentChangeLockRef.current = false;
            }
          });
        });
      },
      [documentId, onEditorInit, onInit, remoteDocumentVersion],
    );

    // Critical fix: if the editor is already initialized, we need to manually call onEditorInit
    // because the onInit callback only fires on the first editor initialization
    useEffect(() => {
      // Avoid duplicate calls: only invoke when documentId changes and editor is initialized
      if (
        editor &&
        isEditorInitialized &&
        !isLoading &&
        !isWaitingForFreshCollaborationSnapshot &&
        initializedDocIdRef.current !== documentId
      ) {
        void handleEditorInit(editor);
      }
    }, [
      documentId,
      editor,
      handleEditorInit,
      isEditorInitialized,
      isLoading,
      isWaitingForFreshCollaborationSnapshot,
    ]);

    useEffect(() => {
      // In collaboration mode Yjs owns all live updates after this document's
      // one-time database bootstrap. Re-applying an autosave/refetch response
      // through setDocument turns the same tree into a new local Yjs insertion
      // and duplicates blocks on every save.
      if (collaborationEnabled) return;
      if (!editor || !isEditorInitialized || isLoading || !remoteDocumentVersion) return;
      if (initializedDocIdRef.current !== documentId) return;
      if (hydratedVersionRef.current === remoteDocumentVersion) return;
      if (isDirty) return;

      void handleEditorInit(editor);
    }, [
      collaborationEnabled,
      documentId,
      editor,
      handleEditorInit,
      isDirty,
      isEditorInitialized,
      isLoading,
      remoteDocumentVersion,
    ]);

    if (error && (isLoading || isWaitingForFreshCollaborationSnapshot) && !isFetchingDocument) {
      return (
        <>
          {unsavedGuardNode}
          <AsyncError
            error={error}
            variant={'page'}
            onRetry={() => {
              void mutate();
            }}
          />
        </>
      );
    }

    if (remoteDocument === null) {
      return (
        <>
          {unsavedGuardNode}
          <NotFound />
        </>
      );
    }

    // Show loading state
    if (isLoading || isWaitingForFreshCollaborationSnapshot) {
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
        {error && (
          <AsyncError
            error={error}
            variant={'inline'}
            onRetry={() => {
              void mutate();
            }}
          />
        )}
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
