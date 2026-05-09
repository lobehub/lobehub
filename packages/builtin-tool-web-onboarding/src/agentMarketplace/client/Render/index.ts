import { AgentMarketplaceApiName } from '../../types';
import SubmitAgentPick from './SubmitAgentPick';

export const AgentMarketplaceRenders = {
  [AgentMarketplaceApiName.submitAgentPick]: SubmitAgentPick,
};

export { default as SubmitAgentPickRender } from './SubmitAgentPick';
