import { type NotebookDocument } from '@lobechat/types';

export interface NotebookState {
  /**
   * Map of topicId -> notebook documents list
   */
  notebookMap: Record<string, NotebookDocument[]>;
}

export const initialNotebookState: NotebookState = {
  notebookMap: {},
};
