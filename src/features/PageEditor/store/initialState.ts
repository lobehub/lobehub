import { type IEditor } from '@lobehub/editor';

export interface PublicState {
  autoSave?: boolean;
  knowledgeBaseId?: string;
  onBack?: () => void;
  onDelete?: () => void;
  onDocumentIdChange?: (newId: string) => void;
  onSave?: () => void;
  pageId?: string;
  parentId?: string;
}

export interface State extends PublicState {
  currentDocId: string | undefined;
  currentEmoji: string | undefined;
  currentTitle: string;
  editor?: IEditor;
  editorState?: any; // EditorState from useEditorState hook
  isDirty: boolean; // Track if there are unsaved changes
  isLoadingContent: boolean; // Track if content is being loaded
  lastSavedContent: string; // Last saved content hash for comparison
  lastUpdatedTime: Date | null;
  saveStatus: 'idle' | 'saving' | 'saved';
  wordCount: number;
}

export const initialState: State = {
  autoSave: true,
  currentDocId: undefined,
  currentEmoji: undefined,
  currentTitle: '',
  isDirty: false,
  isLoadingContent: false,
  lastSavedContent: '',
  lastUpdatedTime: null,
  saveStatus: 'idle',
  wordCount: 0,
};
