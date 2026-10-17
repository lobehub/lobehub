import type { AssistantSliceState } from './slices/assistant/initialState';
import { initialAssistantSliceState } from './slices/assistant/initialState';
import type { GroupAgentSliceState } from './slices/groupAgent/initialState';
import { initialGroupAgentSliceState } from './slices/groupAgent/initialState';
import type { MCPSliceState } from './slices/mcp/initialState';
import { initialMCPSliceState } from './slices/mcp/initialState';
import type { ModelSliceState } from './slices/model/initialState';
import { initialModelSliceState } from './slices/model/initialState';
import type { PluginSliceState } from './slices/plugin/initialState';
import { initialPluginSliceState } from './slices/plugin/initialState';
import type { ProviderSliceState } from './slices/provider/initialState';
import { initialProviderSliceState } from './slices/provider/initialState';
import type { SkillSliceState } from './slices/skill/initialState';
import { initialSkillSliceState } from './slices/skill/initialState';
import type { SocialSliceState } from './slices/social/initialState';
import { initialSocialSliceState } from './slices/social/initialState';
import type { UserSliceState } from './slices/user/initialState';
import { initialUserSliceState } from './slices/user/initialState';

/**
 * State of the discover (marketplace) store: the replica views of its slices,
 * plus each slice's bookkeeping. Slices add their own actions on top.
 */
export type DiscoverStoreState = AssistantSliceState &
  GroupAgentSliceState &
  MCPSliceState &
  ModelSliceState &
  PluginSliceState &
  ProviderSliceState &
  SkillSliceState &
  SocialSliceState &
  UserSliceState;

export const initialState: DiscoverStoreState = {
  ...initialAssistantSliceState,
  ...initialGroupAgentSliceState,
  ...initialMCPSliceState,
  ...initialModelSliceState,
  ...initialPluginSliceState,
  ...initialProviderSliceState,
  ...initialSkillSliceState,
  ...initialSocialSliceState,
  ...initialUserSliceState,
};
