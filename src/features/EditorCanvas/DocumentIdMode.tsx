'use client';

import { type IEditor } from '@lobehub/editor';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { createStoreUpdater } from 'zustand-utils';

import NotFound from '@/components/404';
import AsyncError from '@/components/AsyncError';
import { ArticleSkeleton } from '@/components/Skeleton';
import { useSaveDocumentHotkey } from '@/hooks/useHotkeys';
import { useDocumentStore } from '@/store/document';
import { editorSelectors } from '@/store/document/slices/editor';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { type EditorCanvasProps } from './EditorCanvas';
import InternalEditor from './InternalEditor';
import UnsavedChangesGuard from './UnsavedChangesGuard';

/**
 * Loading skeleton for the editor
 */
const EditorSkeleton = () => (
  <div style={{ paddingBlock: 24 }}>
    <ArticleSkeleton rows={8} />
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
    bodyPending = false,
    collab = false,
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
    const [onEditorInit, handleContentChangeStore, useFetchDocument, performSave, saveVersion] =
      useDocumentStore((s) => [
        s.onEditorInit,
        s.handleContentChange,
        s.useFetchDocument,
        s.performSave,
        s.saveVersion,
      ]);

    const handleManualSave = useCallback(async () => {
      handleContentChangeStore();
      await saveVersion(documentId);
    }, [documentId, handleContentChangeStore, saveVersion]);

    useSaveDocumentHotkey(handleManualSave);

    // Use SWR hook for document fetching (auto-initializes via onSuccess in DocumentStore)
    const {
      data: remoteDocument,
      error,
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

    const handleEditorInit = useCallback(
      (editorInstance: IEditor) => {
        // A room fills the editor itself; loading the stored body would duplicate it.
        if (collab) {
          onInit?.(editorInstance);
          return;
        }
        // This is the first hydration whenever the editor mounts after the document
        // loaded. Record it, or the effect below — whose `isEditorInitialized` is
        // only re-read on a later render (e.g. the version bump of our own autosave)
        // — treats the document as never hydrated and `setDocument`s it again,
        // resetting the caret and selection mid-edit.
        initializedDocIdRef.current = documentId;
        hydratedVersionRef.current = remoteDocumentVersion;

        void onEditorInit(editorInstance, documentId).finally(() => {
          onInit?.(editorInstance);
        });
      },
      [collab, documentId, onEditorInit, onInit, remoteDocumentVersion],
    );

    // Critical fix: if the editor is already initialized, we need to manually call onEditorInit
    // because the onInit callback only fires on the first editor initialization
    useEffect(() => {
      // Avoid duplicate calls: only invoke when documentId changes and editor is initialized
      if (
        !collab &&
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

        void onEditorInit(editor, documentId).finally(() => {
          onInit?.(editor);
          queueMicrotask(() => {
            if (initRunIdRef.current === runId) {
              contentChangeLockRef.current = false;
            }
          });
        });
      }
    }, [
      collab,
      documentId,
      editor,
      isEditorInitialized,
      isLoading,
      onEditorInit,
      onInit,
      remoteDocumentVersion,
    ]);

    useEffect(() => {
      if (collab) return;
      if (!editor || !isEditorInitialized || isLoading || !remoteDocumentVersion) return;
      if (initializedDocIdRef.current !== documentId) return;
      if (hydratedVersionRef.current === remoteDocumentVersion) return;
      if (isDirty) return;

      hydratedVersionRef.current = remoteDocumentVersion;

      // Every autosave mirrors its row into the detail replica, so the version also
      // moves on our own writes. The store body is synced from the editor on each
      // change, so when it still matches the editor nothing remote was adopted:
      // re-hydrating would only `setDocument` the same body and reset the caret and
      // selection mid-edit.
      const doc = useDocumentStore.getState().documents[documentId];
      if (doc && isEqual(editor.getDocument('json'), doc.editorData)) return;

      const runId = ++initRunIdRef.current;
      contentChangeLockRef.current = true;

      void onEditorInit(editor, documentId).finally(() => {
        onInit?.(editor);
        queueMicrotask(() => {
          if (initRunIdRef.current === runId) {
            contentChangeLockRef.current = false;
          }
        });
      });
    }, [
      collab,
      documentId,
      editor,
      isDirty,
      isEditorInitialized,
      isLoading,
      onEditorInit,
      onInit,
      remoteDocumentVersion,
    ]);

    if (error && isLoading && !isFetchingDocument) {
      // The page exists but is private to another member (or not shared with
      // this one): say so instead of a generic load failure or a 404.
      const isForbidden = isTrpcErrorCode(error, 'FORBIDDEN');

      return (
        <>
          {unsavedGuardNode}
          <AsyncError
            description={isForbidden ? t('pageEditor.noAccess.description') : undefined}
            error={error}
            title={isForbidden ? t('pageEditor.noAccess.title') : undefined}
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
        {error && (
          <AsyncError
            error={error}
            variant={'inline'}
            onRetry={() => {
              void mutate();
            }}
          />
        )}
        {bodyPending && <EditorSkeleton />}
        {/* A room binds to the mounted editor, so it stays mounted while the skeleton shows. */}
        <div style={{ display: bodyPending ? 'none' : 'contents' }}>
          <InternalEditor
            contentChangeLockRef={contentChangeLockRef}
            editor={editor}
            placeholder={editorProps.placeholder || t('pageEditor.editorPlaceholder')}
            style={style}
            onContentChange={handleChange}
            onInit={handleEditorInit}
            {...editorProps}
          />
        </div>
      </>
    );
  },
);

DocumentIdMode.displayName = 'DocumentIdMode';

export default DocumentIdMode;
