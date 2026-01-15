'use client';

import { EDITOR_DEBOUNCE_TIME, EDITOR_MAX_WAIT } from '@lobechat/const';
import { type DocumentItem } from '@lobechat/database/schemas';
import { type IEditor } from '@lobehub/editor';
import { debounce } from 'es-toolkit/compat';
import type { SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { useClientDataSWRWithSync } from '@/libs/swr';
import { documentService } from '@/services/document';
import { setNamespace } from '@/utils/storeDebug';

import type { DocumentStore } from '../../store';
import { type DocumentSourceType } from '../editor/initialState';

const n = setNamespace('document/document');

/**
 * Parameters for initializing a document with editor
 */
export interface InitDocumentParams {
  /**
   * Whether auto-save is enabled. Defaults to true.
   * Set to false if the consumer handles saving themselves.
   */
  autoSave?: boolean;
  content?: string | null;
  documentId: string;
  editor: IEditor;
  editorData?: unknown;
  sourceType: DocumentSourceType;
  topicId?: string;
}

/**
 * Options for useFetchDocument hook
 */
export interface UseFetchDocumentOptions {
  /**
   * Whether auto-save is enabled. Defaults to true.
   */
  autoSave?: boolean;
  /**
   * Editor instance to load content into
   */
  editor?: IEditor;
  /**
   * Source type for the document. Defaults to 'page'.
   */
  sourceType?: DocumentSourceType;
}

export interface DocumentAction {
  /**
   * Close a document and remove it from state
   */
  closeDocument: (documentId: string) => void;
  /**
   * Flush any pending debounced save for a document
   */
  flushSave: (documentId?: string) => void;
  /**
   * Initialize a document with editor - stores state only.
   * Content is loaded into editor via onEditorInit when Editor component is ready.
   */
  initDocumentWithEditor: (params: InitDocumentParams) => void;
  /**
   * Trigger a debounced save for the specified document
   */
  triggerDebouncedSave: (documentId: string) => void;
  /**
   * SWR hook to fetch document and initialize in DocumentStore
   */
  useFetchDocument: (
    documentId: string | undefined,
    options?: UseFetchDocumentOptions,
  ) => SWRResponse<DocumentItem | null>;
}

export const createDocumentSlice: StateCreator<
  DocumentStore,
  [['zustand/devtools', never]],
  [],
  DocumentAction
> = (set, get) => {
  // Store debounced save functions per document - inside store closure so `get` is always correct
  const debouncedSaves = new Map<string, ReturnType<typeof debounce>>();

  const getOrCreateDebouncedSave = (documentId: string) => {
    if (!debouncedSaves.has(documentId)) {
      const debouncedFn = debounce(
        async () => {
          try {
            await get().performSave(documentId);
          } catch (error) {
            console.error('[DocumentStore] Failed to auto-save:', error);
          }
        },
        EDITOR_DEBOUNCE_TIME,
        { leading: false, maxWait: EDITOR_MAX_WAIT, trailing: true },
      );
      debouncedSaves.set(documentId, debouncedFn);
    }
    return debouncedSaves.get(documentId)!;
  };

  const cleanupDebouncedSave = (documentId: string) => {
    const fn = debouncedSaves.get(documentId);
    if (fn) {
      fn.cancel();
      debouncedSaves.delete(documentId);
    }
  };

  return {
    closeDocument: (documentId) => {
      // Flush any pending saves before closing
      const save = debouncedSaves.get(documentId);
      if (save) {
        save.flush();
        cleanupDebouncedSave(documentId);
      }

      const { activeDocumentId, internal_dispatchDocument } = get();

      // Delete document via reducer
      internal_dispatchDocument({ id: documentId, type: 'deleteDocument' });

      // Update activeDocumentId if needed
      if (activeDocumentId === documentId) {
        set({ activeDocumentId: undefined }, false, n('closeDocument:clearActive'));
      }
    },

    flushSave: (documentId) => {
      const id = documentId || get().activeDocumentId;
      if (id) {
        const save = debouncedSaves.get(id);
        save?.flush();
      }
    },

    initDocumentWithEditor: (params) => {
      const { documentId, sourceType, content, editorData, topicId, autoSave, editor } = params;

      const { internal_dispatchDocument } = get();

      // Add or update document via reducer
      internal_dispatchDocument({
        id: documentId,
        type: 'addDocument',
        value: {
          autoSave,
          content: content ?? undefined,
          editorData,
          lastSavedContent: content ?? undefined,
          sourceType,
          topicId,
        },
      });

      // Update activeDocumentId and editor
      set({ activeDocumentId: documentId, editor }, false, n('initDocumentWithEditor:setActive'));
    },

    triggerDebouncedSave: (documentId) => {
      const save = getOrCreateDebouncedSave(documentId);
      save();
    },

    useFetchDocument: (documentId, options = {}) => {
      const { autoSave = true, editor, sourceType = 'page' } = options;
      const swrKey = documentId && editor ? ['document/editor', documentId] : null;

      return useClientDataSWRWithSync<DocumentItem | null>(
        swrKey,
        async () => {
          // documentId is guaranteed to be defined when swrKey is not null
          const document = await documentService.getDocumentById(documentId!);
          if (!document) {
            console.warn(`[useFetchDocument] Document not found: ${documentId}`);
            return null;
          }

          return document;
        },
        {
          focusThrottleInterval: 20_000,
          onData: (document) => {
            // Both documentId and editor are guaranteed to be defined when this callback is called
            if (!document || !documentId || !editor) return;

            // Check if this response is still for the current active document
            // This prevents race conditions when quickly switching between documents
            const currentActiveId = get().activeDocumentId;
            if (currentActiveId && currentActiveId !== documentId) {
              // User has already switched to another document, discard this stale response
              return;
            }

            // Initialize document with editor
            get().initDocumentWithEditor({
              autoSave,
              content: document.content,
              documentId,
              editor,
              editorData: document.editorData,
              sourceType,
            });
          },
          revalidateOnFocus: true,
        },
      );
    },
  };
};
