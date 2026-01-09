import { type IEditor } from '@lobehub/editor';

export interface PublicState {
  autoSave?: boolean;
  emoji?: string;
  knowledgeBaseId?: string;
  onBack?: () => void;
  onDelete?: () => void;
  onDocumentIdChange?: (newId: string) => void;
  onEmojiChange?: (emoji: string | undefined) => void;
  onSave?: () => void;
  onTitleChange?: (title: string) => void;
  parentId?: string;
  title?: string;
}

export interface State extends PublicState {
  documentId: string | undefined;
  editor?: IEditor;
}

export const initialState: State = {
  autoSave: true,
  documentId: undefined,
  emoji: undefined,
  title: undefined,
};
