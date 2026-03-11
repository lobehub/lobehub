import { type PartialDeep } from 'type-fest';

import { type AgentSettingsInstance } from '@/features/AgentSetting';
import { type AgentItem } from '@/types/agent';
import { type MetaData } from '@/types/meta';

export type LoadingState = Record<Partial<keyof MetaData> | string, boolean>;
export type SaveStatus = 'idle' | 'saving' | 'saved';

export interface AgentSliceState {
  activeAgentId?: string;
  agentMap: Record<string, PartialDeep<AgentItem>>;
  agentSettingInstance?: AgentSettingsInstance | null;
  /**
   * Whether the agent panel is pinned (UI state)
   */
  isAgentPinned: boolean;
  /**
   * Last time the agent config/meta was updated
   */
  lastUpdatedTime?: Date | null;
  /**
   * Loading state for meta fields (used during autocomplete)
   */
  loadingState: LoadingState;
  /**
   * Save status for showing auto-save hint
   */
  saveStatus: SaveStatus;
  showAgentSetting: boolean;
  /**
   * Content being streamed for system role update
   */
  streamingSystemRole?: string;
  /**
   * Whether system role streaming is in progress
   */
  streamingSystemRoleInProgress?: boolean;
  updateAgentChatConfigSignal?: AbortController;
  updateAgentConfigSignal?: AbortController;
  updateAgentMetaSignal?: AbortController;
}

export const initialAgentSliceState: AgentSliceState = {
  agentMap: {},
  isAgentPinned: false,
  lastUpdatedTime: null,
  loadingState: {
    avatar: false,
    backgroundColor: false,
    description: false,
    tags: false,
    title: false,
  },
  saveStatus: 'idle',
  showAgentSetting: false,
  streamingSystemRole: undefined,
  streamingSystemRoleInProgress: false,
};
