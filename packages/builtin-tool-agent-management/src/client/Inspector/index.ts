import { type BuiltinInspector } from '@lobechat/types';

import { AgentManagementApiName } from '../../types';
import { CallAgentInspector } from './CallAgent';
import { CreateAgentInspector } from './CreateAgent';
import { SearchAgentInspector } from './SearchAgent';
import { UpdateAgentInspector } from './UpdateAgent';

/**
 * Agent Management Inspector Components Registry
 *
 * Inspector components customize the title/header area
 * of tool calls in the conversation UI.
 */
export const AgentManagementInspectors: Record<string, BuiltinInspector> = {
  [AgentManagementApiName.callAgent]: CallAgentInspector as BuiltinInspector,
  [AgentManagementApiName.createAgent]: CreateAgentInspector as BuiltinInspector,
  [AgentManagementApiName.searchAgent]: SearchAgentInspector as BuiltinInspector,
  [AgentManagementApiName.updateAgent]: UpdateAgentInspector as BuiltinInspector,
};
