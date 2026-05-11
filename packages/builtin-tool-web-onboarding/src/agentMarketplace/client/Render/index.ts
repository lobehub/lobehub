import { AgentMarketplaceApiName } from '../../types';
import SubmitAgentPick from './SubmitAgentPick';

// `showAgentMarketplace` is rewritten in place after the user submits — its
// `pluginState` ends up with the same `{ summaries, installedAgentIds, ... }`
// shape that `SubmitAgentPick` consumes (see `customInteractionHandlers.ts`),
// so both APIs reuse the same Render.
export const AgentMarketplaceRenders = {
  [AgentMarketplaceApiName.showAgentMarketplace]: SubmitAgentPick,
  [AgentMarketplaceApiName.submitAgentPick]: SubmitAgentPick,
};

export { default as SubmitAgentPickRender } from './SubmitAgentPick';
