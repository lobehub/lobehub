import type { BuiltinStreaming } from '@lobechat/types';

import { AgentManagementApiName } from '../../types';
import { CreateAgentStreaming } from './CreateAgent';

/**
 * Agent Management Streaming Components Registry
 *
 * Streaming components render tool calls while they are
 * still executing, allowing real-time feedback to users.
 */
export const AgentManagementStreamings: Record<string, BuiltinStreaming> = {
  [AgentManagementApiName.createAgent]: CreateAgentStreaming as BuiltinStreaming,
};

export { CreateAgentStreaming } from './CreateAgent';
