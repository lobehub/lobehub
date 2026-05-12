import { LobeAgentApiName } from '../../types';
import CallSubAgentRender from './CallSubAgent';
import CallSubAgentsRender from './CallSubAgents';

/**
 * Lobe Agent Tool Render Components Registry
 *
 * Sub-agent dispatch operations render a card showing the dispatched
 * task(s). The `analyzeVisualMedia` API has no dedicated render — its
 * textual answer is rendered by the default tool-result UI.
 */
export const LobeAgentRenders = {
  [LobeAgentApiName.callSubAgent]: CallSubAgentRender,
  [LobeAgentApiName.callSubAgents]: CallSubAgentsRender,
};

export { default as CallSubAgentRender } from './CallSubAgent';
export { default as CallSubAgentsRender } from './CallSubAgents';
