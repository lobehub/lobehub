'use client';

import { type IEditor } from '@lobehub/editor';
import { type EditorState as LobehubEditorState } from '@lobehub/editor/react';

/**
 * Document source type - determines which service to use for persistence
 */
export type DocumentSourceType = 'notebook' | 'page';

/**
 * Editor content state for a single document
 * Only contains editor-related state, NOT document metadata (title, emoji, etc.)
 */
export interface EditorContentState {
  /**
   * Whether auto-save is enabled for this document
   * Defaults to true. Set to false if the consumer handles saving themselves.
   */
  autoSave?: boolean;
  /**
   * Document content (markdown)
   */
  content: string;
  /**
   * Editor JSON data (BlockNote format)
   */
  editorData: any;
  /**
   * Whether there are unsaved changes
   */
  isDirty: boolean;
  /**
   * Last saved content for comparison
   */
  lastSavedContent: string;
  /**
   * Last updated time
   */
  lastUpdatedTime: Date | null;
  /**
   * Current save status
   */
  saveStatus: 'idle' | 'saving' | 'saved';
  /**
   * Document source type - determines which service to call for persistence
   */
  sourceType: DocumentSourceType;
  /**
   * Topic ID (for notebook documents, used for save routing)
   */
  topicId?: string;
}

/**
 * Global editor state
 */
export interface EditorState {
  /**
   * Currently active document ID
   */
  activeDocumentId: string | undefined;
  /**
   * Map of editor content states by document ID
   */
  documents: Record<string, EditorContentState>;
  /**
   * Shared editor instance
   */
  editor: IEditor | undefined;
  /**
   * Editor state from useEditorState hook
   */
  editorState: LobehubEditorState | undefined;
}

/**
 * Create initial state for a new document's editor content
 */
export const createInitialEditorContentState = (
  sourceType: DocumentSourceType,
  overrides?: Partial<EditorContentState>,
): EditorContentState => ({
  content: '',
  editorData: null,
  isDirty: false,
  lastSavedContent: '',
  lastUpdatedTime: null,
  saveStatus: 'idle',
  sourceType,
  ...overrides,
});

export const initialEditorState: EditorState = {
  activeDocumentId: undefined,
  documents: {},
  editor: undefined,
  editorState: undefined,
};
