'use client';

import { type IEditor } from '@lobehub/editor';

export interface DocumentEditorState {
  currentTitle: string;
  documentId: string | undefined;
  editor?: IEditor;
  isDirty: boolean;
  lastSavedContent: string;
  lastUpdatedTime: Date | null;
  saveStatus: 'idle' | 'saving' | 'saved';
  topicId: string | undefined;
}

export const initialDocumentEditorState: DocumentEditorState = {
  currentTitle: '',
  documentId: undefined,
  isDirty: false,
  lastSavedContent: '',
  lastUpdatedTime: null,
  saveStatus: 'idle',
  topicId: undefined,
};
