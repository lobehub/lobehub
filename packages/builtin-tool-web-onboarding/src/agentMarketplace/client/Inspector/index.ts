import type { BuiltinInspector } from '@lobechat/types';

import { AgentMarketplaceApiName } from '../../types';
import { ShowAgentMarketplaceInspector } from './ShowAgentMarketplace';
import { SubmitAgentPickInspector } from './SubmitAgentPick';

export const AgentMarketplaceInspectors: Record<string, BuiltinInspector> = {
  [AgentMarketplaceApiName.showAgentMarketplace]: ShowAgentMarketplaceInspector as BuiltinInspector,
  [AgentMarketplaceApiName.submitAgentPick]: SubmitAgentPickInspector as BuiltinInspector,
};

export { default as ShowAgentMarketplaceInspector } from './ShowAgentMarketplace';
export { default as SubmitAgentPickInspector } from './SubmitAgentPick';
