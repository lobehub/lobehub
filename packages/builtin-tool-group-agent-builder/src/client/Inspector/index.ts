// Import shared inspectors from agent-builder
import {
  GetAvailableModelsInspector,
  InstallPluginInspector,
  SearchMarketToolsInspector,
  UpdateConfigInspector,
} from '@lobechat/builtin-tool-agent-builder/client';
import type { BuiltinInspector } from '@lobechat/types';

import { GroupAgentBuilderApiName } from '../../types';
import { BatchCreateAgentsInspector } from './BatchCreateAgents';
import { CreateAgentInspector } from './CreateAgent';
import { GetAgentInfoInspector } from './GetAgentInfo';
import { InviteAgentInspector } from './InviteAgent';
import { RemoveAgentInspector } from './RemoveAgent';
import { SearchAgentInspector } from './SearchAgent';
import { UpdateAgentPromptInspector } from './UpdateAgentPrompt';
import { UpdateGroupInspector } from './UpdateGroup';
import { UpdateGroupPromptInspector } from './UpdateGroupPrompt';

/**
 * Group Agent Builder Inspector Components Registry
 *
 * Inspector components customize the title/header area
 * of tool calls in the conversation UI.
 */
export const GroupAgentBuilderInspectors: Record<string, BuiltinInspector> = {
  // Group-specific inspectors
  [GroupAgentBuilderApiName.batchCreateAgents]: BatchCreateAgentsInspector as BuiltinInspector,
  [GroupAgentBuilderApiName.createAgent]: CreateAgentInspector as BuiltinInspector,
  [GroupAgentBuilderApiName.getAgentInfo]: GetAgentInfoInspector as BuiltinInspector,
  [GroupAgentBuilderApiName.inviteAgent]: InviteAgentInspector as BuiltinInspector,
  [GroupAgentBuilderApiName.removeAgent]: RemoveAgentInspector as BuiltinInspector,
  [GroupAgentBuilderApiName.searchAgent]: SearchAgentInspector as BuiltinInspector,
  [GroupAgentBuilderApiName.updateAgentPrompt]: UpdateAgentPromptInspector as BuiltinInspector,
  [GroupAgentBuilderApiName.updateGroup]: UpdateGroupInspector as BuiltinInspector,
  [GroupAgentBuilderApiName.updateGroupPrompt]: UpdateGroupPromptInspector as BuiltinInspector,

  // Shared inspectors from agent-builder (reused for group context)
  [GroupAgentBuilderApiName.getAvailableModels]: GetAvailableModelsInspector as BuiltinInspector,
  [GroupAgentBuilderApiName.installPlugin]: InstallPluginInspector as BuiltinInspector,
  [GroupAgentBuilderApiName.searchMarketTools]: SearchMarketToolsInspector as BuiltinInspector,
  [GroupAgentBuilderApiName.updateAgentConfig]: UpdateConfigInspector as BuiltinInspector,
};

// Re-export individual inspectors
export { BatchCreateAgentsInspector } from './BatchCreateAgents';
export { CreateAgentInspector } from './CreateAgent';
export { GetAgentInfoInspector } from './GetAgentInfo';
export { InviteAgentInspector } from './InviteAgent';
export { RemoveAgentInspector } from './RemoveAgent';
export { SearchAgentInspector } from './SearchAgent';
export { UpdateAgentPromptInspector } from './UpdateAgentPrompt';
export { UpdateGroupInspector } from './UpdateGroup';
export { UpdateGroupPromptInspector } from './UpdateGroupPrompt';
