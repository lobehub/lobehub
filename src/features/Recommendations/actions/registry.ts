import { HETEROGENEOUS_AGENT_CLIENT_CONFIGS } from '@lobechat/heterogeneous-agents/client';

import { buildHeteroAgentAction } from './heteroAgent';
import type { RecommendedAction } from './types';

/**
 * Registry of all recommended actions. Add new actions here.
 *
 * Each action declares its own eligibility check and execution handler — the
 * Recommendations container filters this list against the current
 * {@link ActionContext} and renders the surviving entries.
 */
export const recommendedActionsRegistry: RecommendedAction[] = [
  ...HETEROGENEOUS_AGENT_CLIENT_CONFIGS.map(buildHeteroAgentAction),
];
