import { type IEditor } from '@lobehub/editor';
import { type EditorState } from '@lobehub/editor/react';

export interface PublicState {}

export interface State extends PublicState {
  editor?: IEditor;
  editorState?: EditorState; // EditorState from useEditorState hook
  /**
   * Content being streamed from AI
   */
  streamingContent?: string;
  /**
   * Whether streaming is in progress
   */
  streamingInProgress?: boolean;
}

export const initialState: State = {
  streamingContent: undefined,
  streamingInProgress: false,
};
