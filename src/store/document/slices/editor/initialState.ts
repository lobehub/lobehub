import { type IEditor } from '@lobehub/editor';

export interface EditorState {
  /**
   * Current document content (markdown)
   */
  activeContent: string;
  /**
   * Current document ID being edited
   */
  activeDocumentId: string | undefined;
  /**
   * Current topic ID for the active document
   */
  activeTopicId: string | undefined;
  /**
   * Editor instance from @lobehub/editor
   */
  editor: IEditor | undefined;
  /**
   * Editor state from useEditorState hook
   */
  editorState: any;
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
   * Edit mode: 'edit' or 'preview'
   */
  mode: 'edit' | 'preview';
  /**
   * Current save status
   */
  saveStatus: 'idle' | 'saving' | 'saved';
  /**
   * Current document title
   */
  title: string;
}

export const initialEditorState: EditorState = {
  activeContent: '',
  activeDocumentId: undefined,
  activeTopicId: undefined,
  editor: undefined,
  editorState: undefined,
  isDirty: false,
  lastSavedContent: '',
  lastUpdatedTime: null,
  mode: 'edit',
  saveStatus: 'idle',
  title: '',
};
