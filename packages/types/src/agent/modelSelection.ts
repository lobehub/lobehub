import type { LobeAgentAgencyConfig } from './agencyConfig';

/** A workspace member's personal model choice for one shared agent. */
export interface AgentModelOverride {
  model: string;
  provider: string;
}

export interface AgentModelConfig {
  agencyConfig?: Pick<LobeAgentAgencyConfig, 'modelSelectionPolicy'>;
  model: string;
  provider?: string;
}

/**
 * Resolve the model used by an agent run.
 *
 * Precedence is deliberately centralized so the server runtime, client
 * fallback, and chat UI cannot drift:
 *
 * explicit per-run override > allowed member override > shared agent model.
 *
 * An omitted policy is fixed. A member override is therefore dormant (but
 * retained) while fixed and becomes effective again when the author reopens
 * member selection.
 */
export const resolveAgentModelConfig = (
  shared: AgentModelConfig,
  memberOverride?: AgentModelOverride | null,
  explicitOverride?: Partial<AgentModelOverride> | null,
): Pick<AgentModelConfig, 'model' | 'provider'> => {
  const effectiveMemberOverride =
    shared.agencyConfig?.modelSelectionPolicy === 'member' ? memberOverride : undefined;

  return {
    model: explicitOverride?.model ?? effectiveMemberOverride?.model ?? shared.model,
    provider: explicitOverride?.provider ?? effectiveMemberOverride?.provider ?? shared.provider,
  };
};
