import { type BuiltinInspector } from '@lobechat/types';

import { AgentManagementApiName } from '../../types';
import { CallAgentInspector } from './CallAgent';
import { CreateAgentInspector } from './CreateAgent';
import { DuplicateAgentInspector } from './DuplicateAgent';
import { GetAgentDetailInspector } from './GetAgentDetail';
import { InstallPluginInspector } from './InstallPlugin';
import { SearchAgentInspector } from './SearchAgent';
import { UpdateAgentInspector } from './UpdateAgent';
import { UpdatePromptInspector } from './UpdatePrompt';

/**
 * Agent Management Inspector Components Registry
 *
 * Inspector components customize the title/header area
 * of tool calls in the conversation UI.
 */
export const AgentManagementInspectors: Record<string, BuiltinInspector> = {
  [AgentManagementApiName.callAgent]: CallAgentInspector as BuiltinInspector,
  [AgentManagementApiName.createAgent]: CreateAgentInspector as BuiltinInspector,
  [AgentManagementApiName.duplicateAgent]: DuplicateAgentInspector as BuiltinInspector,
  [AgentManagementApiName.getAgentDetail]: GetAgentDetailInspector as BuiltinInspector,
  [AgentManagementApiName.installPlugin]: InstallPluginInspector as BuiltinInspector,
  [AgentManagementApiName.searchAgent]: SearchAgentInspector as BuiltinInspector,
  [AgentManagementApiName.updateAgent]: UpdateAgentInspector as BuiltinInspector,
  [AgentManagementApiName.updatePrompt]: UpdatePromptInspector as BuiltinInspector,
};
