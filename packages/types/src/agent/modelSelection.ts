import type { AgentModelSelectionPolicy, LobeAgentAgencyConfig } from './agencyConfig';

/** A workspace member's personal model choice for one shared agent. */
export interface AgentModelOverride {
  model: string;
  provider: string;
}

export interface AgentModelConfig {
  agencyConfig?: Pick<LobeAgentAgencyConfig, 'modelSelectionPolicy'>;
  /** Author/admin callers use the shared model and ignore member overrides. */
  canManage?: boolean;
  model: string;
  provider?: string;
  visibility?: 'private' | 'public';
  workspaceId?: string | null;
}

/**
 * Resolve the model-selection policy for an Agent in its ownership context.
 *
 * Legacy public Workspace Agents predate the persisted policy. They inherit
 * the current Workspace default (`member`), while personal/private Agents keep
 * the shared model and an explicit `fixed` policy always remains authoritative.
 */
export const resolveAgentModelSelectionPolicy = (
  shared: Pick<AgentModelConfig, 'agencyConfig' | 'visibility' | 'workspaceId'>,
): AgentModelSelectionPolicy => {
  const isPublicWorkspaceAgent = !!shared.workspaceId && shared.visibility !== 'private';

  if (!isPublicWorkspaceAgent) return 'fixed';

  return shared.agencyConfig?.modelSelectionPolicy ?? 'member';
};

/**
 * Resolve the model used by an agent run.
 *
 * Precedence is deliberately centralized so the server runtime, client
 * fallback, and chat UI cannot drift:
 *
 * explicit per-run override > allowed member override > shared agent model.
 *
 * A member override is dormant (but retained) while fixed and becomes
 * effective again when the author reopens member selection.
 */
export const resolveAgentModelConfig = (
  shared: AgentModelConfig,
  memberOverride?: AgentModelOverride | null,
  explicitOverride?: Partial<AgentModelOverride> | null,
): Pick<AgentModelConfig, 'model' | 'provider'> => {
  const effectiveMemberOverride =
    shared.canManage !== true && resolveAgentModelSelectionPolicy(shared) === 'member'
      ? memberOverride
      : undefined;

  return {
    model: explicitOverride?.model ?? effectiveMemberOverride?.model ?? shared.model,
    provider: explicitOverride?.provider ?? effectiveMemberOverride?.provider ?? shared.provider,
  };
};
