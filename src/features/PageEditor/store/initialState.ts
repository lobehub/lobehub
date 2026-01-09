import { type IEditor } from '@lobehub/editor';

export interface PublicState {
  autoSave?: boolean;
  knowledgeBaseId?: string;
  onBack?: () => void;
  onDelete?: () => void;
  onDocumentIdChange?: (newId: string) => void;
  onSave?: () => void;
  parentId?: string;
}

export interface State extends PublicState {
  documentId: string | undefined;
  editor?: IEditor;
  emoji: string | undefined;
  title: string;
}

export const initialState: State = {
  autoSave: true,
  documentId: undefined,
  emoji: undefined,
  title: '',
};
