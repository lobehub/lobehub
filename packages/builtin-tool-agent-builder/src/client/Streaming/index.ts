import type { BuiltinStreaming } from '@lobechat/types';

import { AgentBuilderApiName } from '../../types';
import { UpdatePromptStreaming } from './UpdatePrompt';

/**
 * Agent Builder Streaming Components Registry
 *
 * Streaming components render tool calls while they are
 * still executing, allowing real-time feedback to users.
 */
export const AgentBuilderStreamings: Record<string, BuiltinStreaming> = {
  [AgentBuilderApiName.updatePrompt]: UpdatePromptStreaming as BuiltinStreaming,
};

export { UpdatePromptStreaming } from './UpdatePrompt';
