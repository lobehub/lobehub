import type { AgentTopicShareSubject, LobeAgentAgencyConfig } from '@lobechat/types';
import { getHeterogeneousTaskModelProvider } from '@lobechat/types';
import { and, eq, or, sql } from 'drizzle-orm';

import { agents } from '../../schemas';
import { notTrashed } from '../../utils/softDelete';
import { type AgentModelContext } from './context';

/**
 * The three fields a sender-identity snapshot needs, projected and scoped by
 * the model's ownership filter, or `null` when the agent is missing or not
 * visible to the current caller.
 *
 * Deliberately not {@link getAgentConfigById}: that one enriches the agent
 * with its assigned knowledge and loads every enabled file's row and content,
 * which is a lot of I/O to render a label. Callers that only display who an
 * agent is — attribution, receipts — should use this.
 */
export const getAgentDisplayFields = async (
  ctx: AgentModelContext,
  id: string,
): Promise<{ avatar: null | string; name: null | string; title: null | string } | null> => {
  const rows = await ctx.db
    .select({ avatar: agents.avatar, name: agents.name, title: agents.title })
    .from(agents)
    .where(and(eq(agents.id, id), ctx.ownership()))
    .limit(1);

  return rows[0] ?? null;
};

/**
 * Returns the agent's visibility, scoped by the model's ownership filter, or
 * `null` when the agent is missing or not visible to the current caller.
 * Used by the task service to inherit a private agent's visibility onto
 * tasks created against it.
 */
export const getAgentVisibility = async (
  ctx: AgentModelContext,
  id: string,
): Promise<'private' | 'public' | null> => {
  const rows = await ctx.db
    .select({ visibility: agents.visibility })
    .from(agents)
    .where(and(eq(agents.id, id), ctx.ownership()))
    .limit(1);
  return (rows[0]?.visibility as 'private' | 'public' | undefined) ?? null;
};

export const existsById = async (ctx: AgentModelContext, id: string): Promise<boolean> => {
  const rows = await ctx.db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, id), ctx.ownership()))
    .limit(1);

  return rows.length > 0;
};

/**
 * Stricter than {@link existsById}: the agent must be owned (created) by this
 * user, regardless of workspace visibility. `existsById` uses the visibility
 * -aware ownership predicate, so a *public* workspace agent created by another
 * member also returns true — which is only "can see", not "can edit". Callers
 * that bind credentials/config to an agent (e.g. agent-scoped connectors) must
 * use this so a member can't attach an account to someone else's shared agent.
 */
export const existsOwnedById = async (ctx: AgentModelContext, id: string): Promise<boolean> => {
  const rows = await ctx.db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.userId, ctx.userId), notTrashed(agents.isDeleted)))
    .limit(1);

  return rows.length > 0;
};

/**
 * Lightweight lookup of an agent's currently-configured model + provider,
 * used to snapshot the model into a task config so later changes to the
 * agent's default model don't silently affect already-created tasks.
 * Returns null when the agent has no model/provider set, or the agent
 * cannot be found for this user.
 */
export const getAgentModelConfig = async (
  ctx: AgentModelContext,
  idOrSlug: string,
): Promise<{ model: string; provider: string } | null> => {
  const rows = await ctx.db
    .select({ model: agents.model, provider: agents.provider })
    .from(agents)
    .where(and(ctx.ownership(), or(eq(agents.id, idOrSlug), eq(agents.slug, idOrSlug))))
    .limit(1);

  const row = rows[0];
  if (!row || !row.model || !row.provider) return null;
  return { model: row.model, provider: row.provider };
};

/**
 * Single-SELECT lookup of an agent's `agencyConfig`.
 *
 * The task runner needs the target the agent would use on its own — and
 * whether a workspace author FIXED it — to tell a task-level pin the run will
 * use from one the runtime replaces (see `resolveRunDeviceId`). The enriched
 * `getAgentConfig` would drag knowledge/file queries into every run.
 */
export const getAgentAgencyConfig = async (
  ctx: AgentModelContext,
  idOrSlug: string,
): Promise<LobeAgentAgencyConfig | null> => {
  const rows = await ctx.db
    .select({ agencyConfig: agents.agencyConfig })
    .from(agents)
    .where(and(ctx.ownership(), or(eq(agents.id, idOrSlug), eq(agents.slug, idOrSlug))))
    .limit(1);

  return rows[0]?.agencyConfig ?? null;
};

/**
 * Single-SELECT lookup of the fields `TaskService.createTask` needs in one
 * round-trip: the model/provider snapshot (for `task.config`) and the
 * visibility (for inference + cross-table invariant assertion). Replaces
 * the previous two-query path (`getAgentModelConfig` + `getAgentVisibility`).
 *
 * Returns `null` when the agent is not visible to the current caller. When
 * found, `snapshot` is non-null only if both `model` and `provider` are set
 * — same contract as `getAgentModelConfig`.
 *
 * Use when:
 * - Creating a Task with inherited defaults or a native model-only override.
 *
 * Expects:
 * - An Agent ID or slug within the caller's visibility scope.
 *
 * Returns:
 * - The unchanged runtime snapshot and visibility, plus the model override provider
 *   for native or personal API Tasks. Null preserves missing/server-default API bindings.
 */
export const getAgentSnapshotForTaskCreate = async (
  ctx: AgentModelContext,
  idOrSlug: string,
): Promise<{
  /** Provider for model-only Tasks; null rejects inferred API bindings, absent for regular Agents. */
  modelOverrideProvider?: string | null;
  snapshot: { model: string; provider: string } | null;
  visibility: 'private' | 'public';
} | null> => {
  const rows = await ctx.db
    .select({
      agencyConfig: agents.agencyConfig,
      model: agents.model,
      provider: agents.provider,
      visibility: agents.visibility,
    })
    .from(agents)
    .where(and(ctx.ownership(), or(eq(agents.id, idOrSlug), eq(agents.slug, idOrSlug))))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const snapshot = row.model && row.provider ? { model: row.model, provider: row.provider } : null;
  const modelOverrideProvider = getHeterogeneousTaskModelProvider(
    row.agencyConfig?.heterogeneousProvider,
  );
  return {
    ...(modelOverrideProvider !== undefined ? { modelOverrideProvider } : {}),
    snapshot,
    visibility: row.visibility as 'private' | 'public',
  };
};

/**
 * Lightweight lookup used to authorize visibility changes: the agent's
 * creator, slug and current visibility, scoped by the ownership predicate
 * (other members' private agents resolve to `null`).
 */
/**
 * The topic-share policy and creator of one agent.
 *
 * Deliberately scoped by workspace rather than by {@link ownership}: this
 * answers "what did the author decide for this agent", which must not depend
 * on whether the *caller* can see the row. A visibility-scoped miss would
 * return `null` and fail open, handing a restricted agent's topics back to
 * every member.
 */
export const getTopicShareSubject = async (
  ctx: AgentModelContext,
  id: string,
): Promise<AgentTopicShareSubject | null> => {
  const rows = await ctx.db
    .select({
      agencyConfig: agents.agencyConfig,
      userId: agents.userId,
      workspaceId: agents.workspaceId,
    })
    .from(agents)
    .where(
      and(
        eq(agents.id, id),
        ctx.workspaceId ? eq(agents.workspaceId, ctx.workspaceId) : ctx.ownership(),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
};

export const getAgentVisibilityMeta = async (
  ctx: AgentModelContext,
  id: string,
): Promise<{ slug: string | null; userId: string; visibility: 'private' | 'public' } | null> => {
  const rows = await ctx.db
    .select({ slug: agents.slug, userId: agents.userId, visibility: agents.visibility })
    .from(agents)
    .where(and(eq(agents.id, id), ctx.ownership()))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    slug: row.slug,
    userId: row.userId,
    /* v8 ignore next -- unreachable: agents.visibility is NOT NULL (default 'public'), so the `?? 'public'` fallback never runs */
    visibility: (row.visibility as 'private' | 'public' | null) ?? 'public',
  };
};

/**
 * Check if an agent with the given marketIdentifier already exists
 * @returns true if exists, false otherwise
 */
export const checkByMarketIdentifier = async (
  ctx: AgentModelContext,
  marketIdentifier: string,
): Promise<boolean> => {
  const result = await ctx.db.query.agents.findFirst({
    where: and(eq(agents.marketIdentifier, marketIdentifier), ctx.ownership()),
  });
  return !!result;
};

/**
 * Get an agent by marketIdentifier
 * If multiple agents match, returns the most recently updated one
 * @returns agent id if exists, null otherwise
 */
export const getAgentByMarketIdentifier = async (
  ctx: AgentModelContext,
  marketIdentifier: string,
): Promise<string | null> => {
  const result = await ctx.db.query.agents.findFirst({
    columns: { id: true },
    orderBy: (agents, { desc }) => [desc(agents.updatedAt)],
    where: and(eq(agents.marketIdentifier, marketIdentifier), ctx.ownership()),
  });
  return result?.id ?? null;
};

/**
 * Get an agent by the forkedFromIdentifier stored in params
 * @param forkedFromIdentifier - The source agent's market identifier
 * @returns agent id if exists, null otherwise
 */
export const getAgentByForkedFromIdentifier = async (
  ctx: AgentModelContext,
  forkedFromIdentifier: string,
): Promise<string | null> => {
  const result = await ctx.db.query.agents.findFirst({
    columns: { id: true },
    orderBy: (agents, { desc }) => [desc(agents.updatedAt)],
    where: and(
      ctx.ownership(),
      sql`${agents.params}->>'forkedFromIdentifier' = ${forkedFromIdentifier}`,
    ),
  });
  return result?.id ?? null;
};

/**
 * Resolve a user-facing slug to its agent id, scoped by the caller's ownership
 * predicate. Returns `null` when no visible agent owns that slug — callers must
 * treat that as "not found" and must NOT distinguish it from "exists but not
 * yours", or the endpoint becomes an existence oracle for other users' agents.
 */
export const resolveIdBySlug = async (
  ctx: AgentModelContext,
  slug: string,
): Promise<string | null> => {
  const trimmed = slug.trim();
  if (!trimmed) return null;

  const rows = await ctx.db
    .select({ id: agents.id })
    .from(agents)
    .where(and(ctx.ownership(), eq(agents.slug, trimmed)))
    .limit(1);

  return rows[0]?.id ?? null;
};
