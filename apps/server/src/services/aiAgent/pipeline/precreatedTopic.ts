import type { LobeChatDatabase } from '@lobechat/database';
import { TRPCError } from '@trpc/server';

import type { AgentConfigWithId } from '@/server/services/agent';
import { AgentService } from '@/server/services/agent';

import { resolveRunAgentConfig } from './resolveRunAgentConfig';
import { resolveNewTopicSnapshot } from './turnSetup';

/**
 * A topic can be written before `setupTurn` ever runs for it: a scheduled run,
 * a group topic, or a project conversation started from a working directory.
 * `setupTurn` only snapshots the topics it creates itself, so these pre-created
 * rows must snapshot the agent's effective model / provider / reasoning here —
 * otherwise they silently follow later agent-default changes instead of keeping
 * the configuration they were created under.
 */
export interface PrecreatedTopicDeps {
  db: LobeChatDatabase;
  resolveAgentConfigOrThrow: (identifier: string) => Promise<AgentConfigWithId>;
  userId: string;
  workspaceId?: string;
}

/** Resolve the caller model policy before a pre-created topic permanently pins its model. */
export const resolvePrecreatedTopicConfig = async (
  deps: PrecreatedTopicDeps,
  identifier: string,
  overrides?: { model?: string; provider?: string },
): Promise<AgentConfigWithId> => {
  const { agentConfig } = await resolveRunAgentConfig(deps, {
    identifier,
    modelOverride: overrides?.model,
    providerOverride: overrides?.provider,
    throwIfExecutionAborted: async () => {},
  });

  return agentConfig;
};

/**
 * The snapshot a pre-created topic must persist. Shared by every pre-creation
 * path so a topic written ahead of `setupTurn` pins the same
 * model/provider/reasoning `setupTurn` would have pinned itself.
 */
export const resolvePrecreatedTopicSnapshot = async (
  deps: PrecreatedTopicDeps,
  identifier: string,
  overrides?: { model?: string; provider?: string },
) => {
  const agentConfig = await resolvePrecreatedTopicConfig(deps, identifier, overrides);

  return {
    agentConfig,
    snapshot: await resolveNewTopicSnapshot(deps, agentConfig, overrides),
  };
};

/**
 * Resolver for callers outside the ai-agent service (e.g. a lambda router whose
 * topic is created before any turn runs). Resolves through the same
 * {@link AgentService} lookup `AiAgentService` uses, so an agent the caller
 * cannot see resolves to the same uniform NOT_FOUND.
 */
export const createAgentConfigResolver =
  (db: LobeChatDatabase, userId: string, workspaceId?: string) =>
  async (identifier: string): Promise<AgentConfigWithId> => {
    const agentConfig = await new AgentService(db, userId, workspaceId).getAgentConfig(identifier);

    if (!agentConfig) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Agent not found: ${identifier}` });
    }

    return agentConfig;
  };
