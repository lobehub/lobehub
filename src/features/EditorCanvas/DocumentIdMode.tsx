'use client';

import { type IEditor } from '@lobehub/editor';
import isEqual from 'fast-deep-equal';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * Stored markdown length from which a body loads after the switch has painted
 * instead of inside it. Building a long, deeply nested body blocks the main thread
 * for hundreds of milliseconds; inside the click it freezes the previous page until
 * it is done. Shorter bodies keep the atomic swap, so they never flash a skeleton.
 */
const AFTER_PAINT_HYDRATION_MIN_LENGTH = 50_000;

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
    collab = false,
    pendingBody,
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
    // Cancels a load still waiting for the switch to paint.
    const cancelPendingHydrationRef = useRef<(() => void) | undefined>(undefined);

    // The document whose body the editor holds. Until a long body is this one's,
    // the editor (still holding the previous body) hides behind a skeleton.
    const [bodyDocumentId, setBodyDocumentId] = useState<string>();
    const isLongBody = useDocumentStore(
      (s) => editorSelectors.content(documentId)(s).length >= AFTER_PAINT_HYDRATION_MIN_LENGTH,
    );
    const isAwaitingBody = !collab && isLongBody && bodyDocumentId !== documentId;

    // Every load of the stored body runs with the content-change callback locked:
    // the load's own update is not an edit, and reporting it would serialize the
    // whole body again inside the route switch.
    const hydrate = useCallback(
      (editorInstance: IEditor, afterPaint = false) => {
        cancelPendingHydrationRef.current?.();
        cancelPendingHydrationRef.current = undefined;

        const run = () => {
          cancelPendingHydrationRef.current = undefined;
          const runId = ++initRunIdRef.current;
          contentChangeLockRef.current = true;

          void onEditorInit(editorInstance, documentId).finally(() => {
            onInit?.(editorInstance);
            queueMicrotask(() => {
              if (initRunIdRef.current === runId) {
                contentChangeLockRef.current = false;
              }
            });
          });
          setBodyDocumentId(documentId);
        };

        if (!afterPaint) {
          run();
          return;
        }

        // A frame callback runs before that frame paints; a task it queues runs after.
        let timer: number | undefined;
        const frame = window.requestAnimationFrame(() => {
          timer = window.setTimeout(run, 0);
        });
        cancelPendingHydrationRef.current = () => {
          window.cancelAnimationFrame(frame);
          window.clearTimeout(timer);
        };
      },
      [documentId, onEditorInit, onInit],
    );

    // A load waiting for its paint belongs to the document it was scheduled for.
    // Leaving that document first drops it, and a return has to load it again.
    useEffect(
      () => () => {
        if (!cancelPendingHydrationRef.current) return;
        cancelPendingHydrationRef.current();
        cancelPendingHydrationRef.current = undefined;
        if (initializedDocIdRef.current === documentId) initializedDocIdRef.current = null;
      },
      [documentId],
    );

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

        hydrate(editorInstance, isAwaitingBody);
      },
      [collab, documentId, hydrate, isAwaitingBody, onInit, remoteDocumentVersion],
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
        initializedDocIdRef.current = documentId;
        hydratedVersionRef.current = remoteDocumentVersion;

        hydrate(editor, isAwaitingBody);
      }
    }, [
      collab,
      documentId,
      editor,
      hydrate,
      isAwaitingBody,
      isEditorInitialized,
      isLoading,
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

      hydrate(editor);
    }, [
      collab,
      documentId,
      editor,
      hydrate,
      isDirty,
      isEditorInitialized,
      isLoading,
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
        {pendingBody}
        {isAwaitingBody && <EditorSkeleton />}
        {/* A room binds to the mounted editor, so it stays mounted behind the pending body;
            a long body loads into the hidden editor after the switch paints. */}
        <div style={{ display: pendingBody || isAwaitingBody ? 'none' : 'contents' }}>
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
