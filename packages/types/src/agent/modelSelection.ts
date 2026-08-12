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
  /**
   * The Agent's model is a personal choice for *every* member, including the
   * row's creator and Workspace admins — `canManage` does not promote anyone to
   * editing a shared default, and an author-set `fixed` policy cannot lock it.
   *
   * Set for collaborative builtin Agents (Agent Builder, Group Agent Builder,
   * inbox, Page Copilot). Those rows are shared Workspace infrastructure
   * provisioned lazily by whichever member opened the feature first, so
   * `agents.user_id` records an accident of timing rather than authorship —
   * letting it decide a shared model means one member's pick silently becomes
   * everyone else's, with no settings page to change it back.
   */
  personalModelSelection?: boolean;
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
  shared: Pick<
    AgentModelConfig,
    'agencyConfig' | 'personalModelSelection' | 'visibility' | 'workspaceId'
  >,
): AgentModelSelectionPolicy => {
  const isPublicWorkspaceAgent = !!shared.workspaceId && shared.visibility !== 'private';

  if (!isPublicWorkspaceAgent) return 'fixed';

  if (shared.personalModelSelection) return 'member';

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
  // `personalModelSelection` outranks `canManage`: on those rows there is no
  // "shared default" to manage, so an admin reads their own choice like anyone
  // else (see the field doc).
  const readsMemberOverride = shared.personalModelSelection === true || shared.canManage !== true;
  const effectiveMemberOverride =
    readsMemberOverride && resolveAgentModelSelectionPolicy(shared) === 'member'
      ? memberOverride
      : undefined;

  return {
    model: explicitOverride?.model ?? effectiveMemberOverride?.model ?? shared.model,
    provider: explicitOverride?.provider ?? effectiveMemberOverride?.provider ?? shared.provider,
  };
};
