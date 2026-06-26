import type { AgentContextDocument } from '@lobechat/context-engine';
import type { PartialDeep } from 'type-fest';

import { type AgentSettingsInstance } from '@/features/AgentSetting';
import { type AvailableAgentItem } from '@/services/agent';
import { type AgentItem } from '@/types/agent';
import { type MetaData } from '@/types/meta';

import { readAllLocalAgentWorkingDirectories } from '../../utils/localAgentWorkingDirectoryStorage';

export type LoadingState = Record<Partial<keyof MetaData> | string, boolean>;
export type SaveStatus = 'idle' | 'saving' | 'saved';

export interface AgentSliceState {
  activeAgentId?: string;
  /**
   * Per-agent config fetch error message. Lets the UI distinguish "fetch
   * failed" from "still loading" instead of showing an endless skeleton
   * (e.g. 401s are not retried by SWR). Cleared on successful fetch / retry.
   */
  agentConfigErrorMap: Record<string, string>;
  agentDocumentsMap: Record<string, AgentContextDocument[]>;
  agentMap: Record<string, PartialDeep<AgentItem>>;
  agentSettingInstance?: AgentSettingsInstance | null;
  availableAgents?: AvailableAgentItem[];
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
   * Per-agent local working directory. Persisted to localStorage; held in
   * store so subscribers re-render on change.
   */
  localAgentWorkingDirectoryMap: Record<string, string>;
  /**
   * Save status for showing auto-save hint
   */
  saveStatus: SaveStatus;
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
  agentConfigErrorMap: {},
  agentDocumentsMap: {},
  agentMap: {},
  availableAgents: undefined,
  isAgentPinned: false,
  lastUpdatedTime: null,
  localAgentWorkingDirectoryMap: readAllLocalAgentWorkingDirectories(),
  loadingState: {
    avatar: false,
    backgroundColor: false,
    description: false,
    tags: false,
    title: false,
  },
  saveStatus: 'idle',
  streamingSystemRole: undefined,
  streamingSystemRoleInProgress: false,
};
