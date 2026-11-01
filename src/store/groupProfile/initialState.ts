import { type IEditor } from '@lobehub/editor';

import { createReplicaState, type ReplicaState } from '@/libs/replica';

export type SaveStatus = 'idle' | 'saving' | 'saved';

export interface SaveState {
  lastUpdatedTime?: Date | null;
  saveStatus: SaveStatus;
}

export interface PublicState {}

export interface State extends PublicState {
  /**
   * Active tab ID - 'group' for group settings, or agent ID for member editor
   */
  activeTabId: string;
  /**
   * Agent builder content update - when set, triggers editor to load new content
   * Format: { entityId: string (groupId or agentId), content: string, timestamp: number }
   */
  agentBuilderContentUpdate?: {
    content: string;
    entityId: string;
    timestamp: number;
  };
  chatPanelExpanded: boolean;
  editor?: IEditor;
  editorState?: any; // EditorState from useEditorState hook
  /**
   * Save state map by tab ID (key: 'group' | agentId). This is the replica view
   * of `groupProfileSaveResource`.
   */
  saveStateMap: Record<string, SaveState>;
  /** Replica bookkeeping for `saveStateMap` (see `groupProfileSaveResource`). */
  saveStateMapReplica: ReplicaState<SaveState>;
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
  activeTabId: 'group',
  chatPanelExpanded: true,
  saveStateMap: {},
  saveStateMapReplica: createReplicaState(),
  streamingContent: undefined,
  streamingInProgress: false,
};
