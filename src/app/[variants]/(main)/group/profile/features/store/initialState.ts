import { type IEditor } from '@lobehub/editor';

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface PublicState {}

export interface State extends PublicState {
  chatPanelExpanded: boolean;
  editor?: IEditor;
  editorState?: any; // EditorState from useEditorState hook
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
  chatPanelExpanded: true,
  streamingContent: undefined,
  streamingInProgress: false,
};
