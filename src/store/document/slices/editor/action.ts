'use client';

import type { IEditor } from '@lobehub/editor/es/types';
import { type EditorState as LobehubEditorState } from '@lobehub/editor/react';
import isEqual from 'fast-deep-equal';
import { type StateCreator } from 'zustand/vanilla';

import { documentService } from '@/services/document';
import { setNamespace } from '@/utils/storeDebug';

import type { DocumentStore } from '../../store';
import { type DocumentDispatch, documentReducer } from './reducer';

const n = setNamespace('document/editor');

/**
 * Metadata passed in at save time (not stored in editor state)
 */
export interface SaveMetadata {
  emoji?: string;
  title?: string;
}

export interface EditorAction {
  /**
   * Get current content from editor
   */
  getEditorContent: () => { editorData: any; markdown: string } | null;
  /**
   * Handle content change from editor
   */
  handleContentChange: () => void;
  /**
   * Dispatch action to update documents map
   */
  internal_dispatchDocument: (payload: DocumentDispatch, action?: string) => void;
  /**
   * Mark a document as dirty
   */
  markDirty: (documentId: string) => void;
  /**
   * Called when editor is initialized
   */
  onEditorInit: (editor: IEditor) => Promise<void>;
  /**
   * Perform save operation for a document
   * @param documentId - Document ID (defaults to active document)
   * @param metadata - Document metadata (title, emoji) passed from caller
   */
  performSave: (documentId?: string, metadata?: SaveMetadata) => Promise<void>;
  /**
   * Set editor state from useEditorState hook
   */
  setEditorState: (editorState: LobehubEditorState | undefined) => void;
}

export const createEditorSlice: StateCreator<
  DocumentStore,
  [['zustand/devtools', never]],
  [],
  EditorAction
> = (set, get) => ({
  getEditorContent: () => {
    const { editor } = get();
    if (!editor) return null;

    try {
      const markdown = (editor.getDocument('markdown') as unknown as string) || '';
      const editorData = editor.getDocument('json');
      return { editorData, markdown };
    } catch (error) {
      console.error('[DocumentStore] Failed to get editor content:', error);
      return null;
    }
  },

  handleContentChange: () => {
    const { editor, activeDocumentId, documents, internal_dispatchDocument } = get();
    if (!editor || !activeDocumentId) return;

    const doc = documents[activeDocumentId];
    if (!doc) return;

    try {
      const markdown = (editor.getDocument('markdown') as unknown as string) || '';
      const editorData = editor.getDocument('json');

      // Check if content actually changed
      const contentChanged = markdown !== doc.lastSavedContent;

      internal_dispatchDocument(
        {
          id: activeDocumentId,
          type: 'updateDocument',
          value: { content: markdown, editorData, isDirty: contentChanged },
        },
        'handleContentChange',
      );

      // Only trigger auto-save if content actually changed AND autoSave is enabled
      if (contentChanged && doc.autoSave !== false) {
        get().triggerDebouncedSave(activeDocumentId);
      }
    } catch (error) {
      console.error('[DocumentStore] Failed to update content:', error);
    }
  },

  internal_dispatchDocument: (payload, action) => {
    const { documents } = get();
    const nextDocuments = documentReducer(documents, payload);

    if (isEqual(documents, nextDocuments)) return;

    set(
      { documents: nextDocuments },
      false,
      action ?? n(`dispatchDocument/${payload.type}`, { id: payload.id }),
    );
  },

  markDirty: (documentId) => {
    const { documents, internal_dispatchDocument } = get();
    if (!documents[documentId]) return;

    internal_dispatchDocument({ id: documentId, type: 'updateDocument', value: { isDirty: true } });
  },

  onEditorInit: async (editor) => {
    const { activeDocumentId, documents } = get();
    if (!editor || !activeDocumentId) return;

    const doc = documents[activeDocumentId];

    if (!doc) return;

    // Check if editorData is valid and non-empty
    const hasValidEditorData =
      doc.editorData &&
      typeof doc.editorData === 'object' &&
      Object.keys(doc.editorData).length > 0;

    // Set content from document state
    if (hasValidEditorData) {
      try {
        editor.setDocument('json', JSON.stringify(doc.editorData));
        return;
      } catch {
        // Fallback to markdown if JSON fails
        console.warn('[DocumentStore] Failed to load editorData, falling back to markdown');
      }
    }

    // Load markdown content if available
    // Skip setDocument for empty content - let editor use its default empty state
    if (doc.content?.trim()) {
      try {
        editor.setDocument('markdown', doc.content);
      } catch (err) {
        console.error('[DocumentStore] Failed to load markdown content:', err);
      }
    }

    set({ editor });
  },

  performSave: async (documentId, metadata) => {
    const id = documentId || get().activeDocumentId;

    if (!id) return;

    const { editor, documents, internal_dispatchDocument } = get();
    const doc = documents[id];
    if (!doc || !editor) return;

    // Skip save if no changes
    if (!doc.isDirty) return;

    // Update save status
    internal_dispatchDocument({ id, type: 'updateDocument', value: { saveStatus: 'saving' } });

    try {
      const currentContent = (editor.getDocument('markdown') as unknown as string) || '';
      const currentEditorData = editor.getDocument('json');

      // Save document
      await documentService.updateDocument({
        content: currentContent,
        editorData: JSON.stringify(currentEditorData),
        id,
        metadata: metadata?.emoji ? { emoji: metadata.emoji } : undefined,
        title: metadata?.title,
      });

      // Mark as clean and update save status
      internal_dispatchDocument({
        id,
        type: 'updateDocument',
        value: {
          editorData: structuredClone(currentEditorData),
          isDirty: false,
          lastSavedContent: currentContent,
          lastUpdatedTime: new Date(),
          saveStatus: 'saved',
        },
      });
    } catch (error) {
      console.error('[DocumentStore] Failed to save:', error);
      internal_dispatchDocument({ id, type: 'updateDocument', value: { saveStatus: 'idle' } });
    }
  },

  setEditorState: (editorState) => {
    set({ editorState }, false, n('setEditorState'));
  },
});
