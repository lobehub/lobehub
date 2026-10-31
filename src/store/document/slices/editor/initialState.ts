'use client';

import type { IEditor } from '@lobehub/editor';
import type { EditorState as LobehubEditorState } from '@lobehub/editor/react';

import type { SaveStatus } from '@/types/saveState';

/**
 * Document source type - determines which service to use for persistence
 */
export type DocumentSourceType = 'notebook' | 'page';
/**
 * - `html`: a self-contained HTML page. It is rendered in a sandboxed frame and
 *   never loaded into, read from or saved through the rich-text editor.
 */
export type DocumentContentFormat = 'html' | 'markdown' | 'skillMarkdown';

/**
 * Editor content state for a single document
 * Only contains editor-related state, NOT document metadata (title, emoji, etc.)
 */
export interface EditorContentState {
  /**
   * Agent commands editing the stored page right now. Without a collaboration
   * room the page is read-only meanwhile, so an edit typed in between can't be
   * overwritten by, or overwrite, the agent's write.
   */
  agentEditing?: number;
  /**
   * Whether auto-save is enabled for this document
   * Defaults to true. Set to false if the consumer handles saving themselves.
   */
  autoSave?: boolean;
  /**
   * Set when the last save was refused for exceeding the plan's per-document
   * character limit. The body stays dirty and unsaved; cleared by the next
   * successful save.
   */
  charLimitError?: { actual: number; limit: number; plan?: string };
  /**
   * The body syncs through a live collaboration room, which persists it; local
   * saves only carry metadata.
   */
  collab?: boolean;
  /**
   * Document content (markdown)
   */
  content: string;
  /**
   * Content format used by the editor persistence pipeline.
   */
  contentFormat?: DocumentContentFormat;

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
   * Last saved editor JSON for comparison
   */
  lastSavedEditorData?: any;
  /**
   * Last updated time
   */
  lastUpdatedTime: Date | null;
  /**
   * The body as the editor serialized it right after loading it. Loading is not
   * byte-stable (fresh node ids, the editor's own markdown export), so a body
   * equal to this is unedited even when it differs from `lastSaved*`. Only the
   * dirty check reads it; `lastSaved*` stays the server's body, which conflict
   * reconciliation compares remote rows against. Cleared once a save lands.
   */
  loadedBody?: { content: string; editorData: unknown };
  /**
   * Edit-session id that currently owns this document's collaborative lock.
   * Used by workspace page saves to prove the client still holds the lease.
   */
  lockOwnerId?: string;
  /**
   * True when the last save was rejected because another collaborator holds the
   * document's edit lock. Lets the editor flip to read-only immediately instead
   * of waiting for the next lock heartbeat. Cleared on the next successful save.
   */
  saveBlockedByLock?: boolean;
  /**
   * Current save status
   */
  saveStatus: SaveStatus;
  /**
   * YAML frontmatter for SKILL.md documents. It is kept outside the rich Markdown editor because
   * the editor parses the closing `---` as a Setext heading underline and renders metadata as a giant heading.
   */
  skillFrontmatter?: string;
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
  /**
   * Last notebook document opened from each topic.
   */
  lastActiveTopicDocumentIdByTopicId: Record<string, string>;
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
  lastSavedEditorData: null,
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
  lastActiveTopicDocumentIdByTopicId: {},
};
