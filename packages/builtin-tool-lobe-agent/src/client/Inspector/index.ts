import type { BuiltinInspector } from '@lobechat/types';

import { LobeAgentApiName } from '../../types';
import { CallSubAgentInspector } from './CallSubAgent';
import { CallSubAgentsInspector } from './CallSubAgents';

/**
 * Lobe Agent Inspector Components Registry
 *
 * Inspector components customize the title/header area
 * of tool calls in the conversation UI.
 */
export const LobeAgentInspectors: Record<string, BuiltinInspector> = {
  [LobeAgentApiName.callSubAgent]: CallSubAgentInspector as BuiltinInspector,
  [LobeAgentApiName.callSubAgents]: CallSubAgentsInspector as BuiltinInspector,
};
