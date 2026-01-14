import { GroupAgentBuilderApiName } from '../../types';
import BatchCreateAgents from './BatchCreateAgents';
import UpdateAgentPrompt from './UpdateAgentPrompt';
import UpdateGroupPrompt from './UpdateGroupPrompt';

/**
 * Group Agent Builder Render Components Registry
 *
 * Render components display the results of tool calls
 * in a user-friendly format.
 */
export const GroupAgentBuilderRenders = {
  [GroupAgentBuilderApiName.batchCreateAgents]: BatchCreateAgents,
  [GroupAgentBuilderApiName.updateAgentPrompt]: UpdateAgentPrompt,
  [GroupAgentBuilderApiName.updateGroupPrompt]: UpdateGroupPrompt,
};
