import { getAgentPersistConfig } from '@lobechat/builtin-agents';
import { INBOX_SESSION_ID } from '@lobechat/const';
import { and, eq } from 'drizzle-orm';
import pMap from 'p-map';

import type { AgentItem } from '../../schemas';
import { agents, agentsToSessions, sessions } from '../../schemas';
import { normalizeInboxAgentMeta } from '../../utils/inboxAgent';
import { sanitizeAgentApiConfig } from '../../utils/sanitizeAgentApiConfig';
import { buildWorkspacePayload } from '../../utils/workspace';
import { RESERVED_AGENT_SLUGS } from './constants';
import { type AgentModelContext } from './context';

export const stripReservedSlug = <T extends { slug?: string | null }>(config: T): T => {
  if (!config.slug || !RESERVED_AGENT_SLUGS.has(config.slug)) return config;
  return { ...config, slug: undefined };
};

/**
 * Create an agent record only (without creating a session).
 * This is used for creating virtual agents (e.g., group chat members).
 */
export const create = async (
  ctx: AgentModelContext,
  input: Partial<AgentItem>,
): Promise<AgentItem> => {
  const config = stripReservedSlug(input);
  const agencyConfig = ctx.withWorkspaceSelectionPolicyDefaults(
    sanitizeAgentApiConfig(config.agencyConfig),
  );

  await ctx.assertWorkspaceDeviceBinding(ctx.workspaceId ?? null, agencyConfig);
  await ctx.assertFixedExecutionTarget(ctx.workspaceId ?? null, agencyConfig);

  const [result] = await ctx.db
    .insert(agents)
    .values([
      buildWorkspacePayload(
        { userId: ctx.userId, workspaceId: ctx.workspaceId },
        {
          ...config,
          agencyConfig,
          model: typeof config.model === 'string' ? config.model : null,
        },
      ),
    ])
    .returning();

  return result;
};

/**
 * Batch create multiple agents (without sessions).
 * Used for creating multiple virtual agents at once (e.g., group chat members).
 */
export const batchCreate = async (
  ctx: AgentModelContext,
  configs: Partial<AgentItem>[],
): Promise<AgentItem[]> => {
  if (configs.length === 0) return [];

  const normalizedConfigs = configs.map((config) => ({
    ...stripReservedSlug(config),
    agencyConfig: ctx.withWorkspaceSelectionPolicyDefaults(
      sanitizeAgentApiConfig(config.agencyConfig),
    ),
  }));

  // Each config's assertions read device bindings / execution targets; cap
  // the fan-out so a large batch cannot open 2×N concurrent queries.
  await pMap(
    normalizedConfigs,
    (config) =>
      Promise.all([
        ctx.assertWorkspaceDeviceBinding(ctx.workspaceId ?? null, config.agencyConfig),
        ctx.assertFixedExecutionTarget(ctx.workspaceId ?? null, config.agencyConfig),
      ]),
    { concurrency: 5 },
  );

  return ctx.db
    .insert(agents)
    .values(
      normalizedConfigs.map((config) =>
        buildWorkspacePayload(
          { userId: ctx.userId, workspaceId: ctx.workspaceId },
          {
            ...config,
            model: typeof config.model === 'string' ? config.model : null,
          },
        ),
      ),
    )
    .returning();
};

/**
 * Duplicate an agent.
 * Returns the new agent ID.
 */
export const duplicate = async (
  ctx: AgentModelContext,
  agentId: string,
  newTitle?: string,
): Promise<{ agentId: string } | null> => {
  // Get the source agent
  const sourceAgent = await ctx.db.query.agents.findFirst({
    where: and(eq(agents.id, agentId), ctx.ownership()),
  });

  if (!sourceAgent) return null;

  // The copy is owned by the caller, so device references must be resolvable
  // by the caller too. A public workspace agent may still carry a legacy
  // personal-device `boundDeviceId` / `workingDirByDevice` that `updateConfig`
  // grandfathers; duplicating it verbatim would point the new agent at a
  // device outside the workspace instead of defaulting to the caller's own
  // device. Sanitize exactly like `transferAgents` does when moving into a
  // workspace. Personal-scope copies keep existing bindings (any device is
  // reachable there).
  const agencyConfig = ctx.workspaceId
    ? (
        await ctx.sanitizeAgencyConfigForWorkspace(ctx.db, ctx.workspaceId, [
          sourceAgent.agencyConfig,
        ])
      )[0]
    : (sourceAgent.agencyConfig ?? null);

  // Create new agent with explicit include fields
  const [newAgent] = await ctx.db
    .insert(agents)
    .values(
      buildWorkspacePayload(
        { userId: ctx.userId, workspaceId: ctx.workspaceId },
        {
          // Agency config (heterogeneous provider, execution target, device
          // binding, sub-agent defaults, verify rubric...). Duplicating must
          // preserve it, otherwise a heterogeneous agent is copied as a plain
          // one and its external runtime config is silently lost.
          agencyConfig,
          avatar: sourceAgent.avatar,
          backgroundColor: sourceAgent.backgroundColor,
          chatConfig: sourceAgent.chatConfig,
          description: sourceAgent.description,
          fewShots: sourceAgent.fewShots,
          model: sourceAgent.model,
          openingMessage: sourceAgent.openingMessage,
          openingQuestions: sourceAgent.openingQuestions,
          params: sourceAgent.params,
          pinned: sourceAgent.pinned,
          // Config
          plugins: sourceAgent.plugins,
          provider: sourceAgent.provider,

          // Session group. Visibility has to travel with it: the column
          // defaults to `public`, and now that folder placement is shared and
          // authoritative, a private agent duplicated into its private folder
          // would be published to the workspace and still render in Ungrouped,
          // since a public item resolves only against public folders.
          sessionGroupId: sourceAgent.sessionGroupId,
          visibility: sourceAgent.visibility,
          systemRole: sourceAgent.systemRole,

          tags: sourceAgent.tags,
          // Metadata
          title: newTitle || (sourceAgent.title ? `${sourceAgent.title} (Copy)` : 'Copy'),
          tts: sourceAgent.tts,
        },
      ),
    )
    .returning();

  return { agentId: newAgent.id };
};

/**
 * Get a builtin agent by slug, creating it if it doesn't exist.
 * Builtin agents are standalone agents not bound to sessions.
 *
 */
export const getBuiltinAgent = async (
  ctx: AgentModelContext,
  slug: string,
): Promise<AgentItem | null> => {
  const persistConfig = getAgentPersistConfig(slug);

  // 1. First try to find existing agent by slug
  const existing = await ctx.db.query.agents.findFirst({
    where: and(eq(agents.slug, slug), ctx.ownership()),
  });

  if (existing) {
    if (persistConfig?.chatConfig) {
      const [updated] = await ctx.db
        .update(agents)
        .set({ chatConfig: persistConfig.chatConfig })
        .where(eq(agents.id, existing.id))
        .returning();
      return normalizeInboxAgentMeta(updated ?? existing, { slug: existing.slug });
    }
    return normalizeInboxAgentMeta(existing, { slug: existing.slug });
  }

  // For inbox agent, it has special compatibility handling:
  // Historical inbox was stored as session with slug='inbox' and linked agent via agentsToSessions
  // If found, update the agent's slug to 'inbox' for future direct queries
  if (slug === INBOX_SESSION_ID) {
    // Use join query for better performance instead of multiple findFirst calls
    const result = await ctx.db
      .select({ agent: agents })
      .from(sessions)
      .innerJoin(agentsToSessions, eq(sessions.id, agentsToSessions.sessionId))
      .innerJoin(agents, eq(agentsToSessions.agentId, agents.id))
      .where(and(eq(sessions.slug, INBOX_SESSION_ID), ctx.sessionsOwnership()))
      .limit(1);

    if (result.length > 0 && result[0].agent) {
      // Update the agent's slug to 'inbox' for future direct queries
      // Use both id and userId to ensure we only update current user's agent
      const [updatedAgent] = await ctx.db
        .update(agents)
        .set({ slug: INBOX_SESSION_ID, virtual: true })
        .where(eq(agents.id, result[0].agent.id))
        .returning();

      return normalizeInboxAgentMeta(updatedAgent, { slug: updatedAgent.slug });
    }
  }

  // 3. Check if this is a known builtin agent
  if (!persistConfig) return null;

  // 4. Create the builtin agent with persist config.
  // Idempotent under concurrent callers: two parallel requests for the same
  // (userId, slug) both see no existing row and race to insert. Without
  // `onConflictDoNothing`, the loser hits the `agents_slug_user_id_unique`
  // constraint; with it, the loser's `.returning()` is empty and we re-read
  // the row that won.
  // Bare `onConflictDoNothing()` (no target) does NOT pin an arbiter index,
  // so it works whether `agents_slug_user_id_unique` is the legacy full
  // unique or the migration-0109 partial (WHERE workspace_id IS NULL) — this
  // is the transition-safe form while 0109 rolls out. Tighten back to a
  // partitioned { target, where } once 0109 has flipped the index in every
  // environment. Payload still carries workspaceId so workspace-scoped
  // builtin agents land in the right workspace.
  const result = await ctx.db
    .insert(agents)
    .values(
      buildWorkspacePayload(
        { userId: ctx.userId, workspaceId: ctx.workspaceId },
        {
          agencyConfig: ctx.withWorkspaceSelectionPolicyDefaults(undefined),
          chatConfig: persistConfig.chatConfig,
          model: persistConfig.model,
          provider: persistConfig.provider,
          slug: persistConfig.slug,
          virtual: true,
        },
      ),
    )
    .onConflictDoNothing()
    .returning();

  if (result[0]) return normalizeInboxAgentMeta(result[0], { slug: result[0].slug });

  const agent = await ctx.db.query.agents.findFirst({
    where: and(eq(agents.slug, slug), ctx.ownership()),
  });

  return agent ? normalizeInboxAgentMeta(agent, { slug: agent.slug }) : null;
};
