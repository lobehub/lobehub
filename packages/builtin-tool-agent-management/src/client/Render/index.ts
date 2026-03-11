import { AgentManagementApiName } from '../../types';
import CallAgentRender from './CallAgent';
import CreateAgentRender from './CreateAgent';
import SearchAgentRender from './SearchAgent';
import UpdateAgentRender from './UpdateAgent';

/**
 * Agent Management Tool Render Components Registry
 */
export const AgentManagementRenders = {
  [AgentManagementApiName.callAgent]: CallAgentRender,
  [AgentManagementApiName.createAgent]: CreateAgentRender,
  [AgentManagementApiName.searchAgent]: SearchAgentRender,
  [AgentManagementApiName.updateAgent]: UpdateAgentRender,
};

export { default as CallAgentRender } from './CallAgent';
export { default as CreateAgentRender } from './CreateAgent';
export { default as SearchAgentRender } from './SearchAgent';
export { default as UpdateAgentRender } from './UpdateAgent';
