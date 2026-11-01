import type { BuiltinStreaming } from '@lobechat/types';

import { LobeAgentApiName } from '../../types';
import { CallSubAgentStreaming } from './CallSubAgent';
import { CreatePlanStreaming } from './CreatePlan';

/**
 * Lobe Agent Streaming Components Registry
 *
 * Streaming components render tool calls while they are still
 * executing, allowing real-time feedback to users.
 */
export const LobeAgentStreamings: Record<string, BuiltinStreaming> = {
  [LobeAgentApiName.callSubAgent]: CallSubAgentStreaming as BuiltinStreaming,
  [LobeAgentApiName.createPlan]: CreatePlanStreaming as BuiltinStreaming,
};

export { CallSubAgentStreaming } from './CallSubAgent';
export { CreatePlanStreaming } from './CreatePlan';
