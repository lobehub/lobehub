import type { BuiltinStreaming } from '@lobechat/types';

import { GroupAgentBuilderApiName } from '../../types';
import { BatchCreateAgentsStreaming } from './BatchCreateAgents';
import { UpdateAgentPromptStreaming } from './UpdateAgentPrompt';
import { UpdateGroupPromptStreaming } from './UpdateGroupPrompt';

/**
 * Group Agent Builder Streaming Components Registry
 *
 * Streaming components render tool calls while they are
 * still executing, allowing real-time feedback to users.
 */
export const GroupAgentBuilderStreamings: Record<string, BuiltinStreaming> = {
  [GroupAgentBuilderApiName.batchCreateAgents]: BatchCreateAgentsStreaming as BuiltinStreaming,
  [GroupAgentBuilderApiName.updateAgentPrompt]: UpdateAgentPromptStreaming as BuiltinStreaming,
  [GroupAgentBuilderApiName.updateGroupPrompt]: UpdateGroupPromptStreaming as BuiltinStreaming,
};

export { BatchCreateAgentsStreaming } from './BatchCreateAgents';
export { UpdateAgentPromptStreaming } from './UpdateAgentPrompt';
export { UpdateGroupPromptStreaming } from './UpdateGroupPrompt';
