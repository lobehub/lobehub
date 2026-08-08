import { type IEditor } from '@lobehub/editor';
import { type EditorState } from '@lobehub/editor/react';

import { type SaveStatus } from '@/types/saveState';

export interface EditLockState {
  holderId: string | null;
  lockedByOther: boolean;
  /** True until the first lock peek resolves; the editor stays read-only until then. */
  pending: boolean;
}

export interface PublicState {}

export interface State extends PublicState {
  editor?: IEditor;
  editorState?: EditorState; // EditorState from useEditorState hook
  /**
   * Edit-intent latch: flips true on the user's first real edit so the lock
   * driver acquires the lock implicitly. Reset when the open agent changes.
   */
  hasEdited?: boolean;
  /**
   * Collaborative edit-lock state, driven by the always-mounted lock host so it
   * is resolved before the (loading-gated) editor renders.
   */
  lockState: EditLockState;
  /** Timestamp of the latest successful Prompt autosave. */
  promptLastUpdatedTime: Date | null;
  /** Save lifecycle owned only by the Prompt editor. */
  promptSaveStatus: SaveStatus;
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
  hasEdited: false,
  // Start pending (read-only) so the editor never flashes editable before the
  // lock driver has resolved whether the agent is free.
  lockState: { holderId: null, lockedByOther: false, pending: true },
  promptLastUpdatedTime: null,
  promptSaveStatus: 'idle',
  streamingContent: undefined,
  streamingInProgress: false,
};
