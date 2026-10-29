import { DEFAULT_INBOX_TITLE, INBOX_SESSION_ID } from '@lobechat/const';
import type { AgentRankItem } from '@lobechat/types';
import { and, count, desc, eq, gt, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import { agents, topics } from '../../schemas';
import { genEndDateWhere, genRangeWhere, genStartDateWhere, genWhere } from '../../utils/genWhere';
import { normalizeInboxAgentMeta } from '../../utils/inboxAgent';
import { notShareVisitorTopic } from '../../utils/shareVisitor';
import { notTrashed } from '../../utils/softDelete';
import { type AgentModelContext } from './context';
import { type DeviceBindingCandidate } from './types';

/**
 * Rank the user's agents by topic count (agent usage ranking). Counts topics
 * directly via `topics.agentId`, so it is agent-native — no sessionId. Mirrors
 * the recents filter: real agents plus the inbox, excluding other virtual agents.
 *
 * Share-visitor topics are excluded from the count: they carry the creator's
 * `userId` (so the plain join would count them) but reflect visitor usage,
 * not the creator's own — same rule as `TopicModel.rank` and every other
 * creator-facing aggregate (see `notShareVisitorTopic`). Applied in the join
 * condition rather than `where` so agents whose ONLY topics are visitor ones
 * still drop out via the `count > 0` guard instead of being filtered away
 * before grouping.
 */
export const rank = async (
  ctx: AgentModelContext,
  limit: number = 10,
): Promise<AgentRankItem[]> => {
  const rows = await ctx.db
    .select({
      avatar: agents.avatar,
      backgroundColor: agents.backgroundColor,
      count: count(topics.id).as('count'),
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      title: agents.title,
    })
    .from(agents)
    .leftJoin(
      topics,
      and(eq(topics.agentId, agents.id), notShareVisitorTopic(), notTrashed(topics.isDeleted)),
    )
    .where(and(ctx.ownership(), or(eq(agents.slug, INBOX_SESSION_ID), ne(agents.virtual, true))))
    .groupBy(agents.id)
    .having(({ count }) => gt(count, 0))
    .orderBy(desc(sql`count`))
    .limit(limit);

  return rows.map(({ slug, ...row }) => normalizeInboxAgentMeta(row, { slug }));
};

/**
 * Candidate agents for a device's "bound agents" list: agents whose stored
 * agency config routes execution there (`device`, or a desktop `local` pick,
 * which also records its own `boundDeviceId`), plus `extraAgentIds` — agents
 * a caller's per-agent device override may route there. Candidates pass the
 * same visibility gate, so an id the caller cannot see is dropped rather
 * than leaked.
 *
 * The routing fields ride along because the stored config is only a
 * baseline: the caller merges their own override over it (see
 * `resolveAgentAgencyConfig`) and keeps the agents whose EFFECTIVE target
 * is still this device.
 */
export const queryBoundToDevice = async (
  ctx: AgentModelContext,
  deviceId: string,
  extraAgentIds: string[] = [],
): Promise<DeviceBindingCandidate[]> => {
  const boundHere = and(
    sql`${agents.agencyConfig} ->> 'boundDeviceId' = ${deviceId}`,
    sql`${agents.agencyConfig} ->> 'executionTarget' IN ('device', 'local')`,
  );

  const rows = await ctx.db
    .select({
      agencyConfig: agents.agencyConfig,
      avatar: agents.avatar,
      backgroundColor: agents.backgroundColor,
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      title: agents.title,
      userId: agents.userId,
      visibility: agents.visibility,
      workspaceId: agents.workspaceId,
    })
    .from(agents)
    .where(
      and(
        ctx.ownership(),
        or(eq(agents.slug, INBOX_SESSION_ID), ne(agents.virtual, true)),
        extraAgentIds.length > 0 ? or(boundHere, inArray(agents.id, extraAgentIds)) : boundHere,
      ),
    )
    .orderBy(desc(agents.updatedAt));

  return rows.map(({ slug, ...row }) => normalizeInboxAgentMeta(row, { slug }));
};

/**
 * The stored routing config of the given agents, for resolving where each runs
 * for the caller in ONE read (a sidebar decorating many agents) instead of one
 * config fetch per agent. Same visibility gate and row shape as
 * {@link queryBoundToDevice}: an id the caller cannot see is dropped, never
 * leaked.
 */
export const queryAgencyRoutingByIds = async (
  ctx: AgentModelContext,
  agentIds: string[],
): Promise<DeviceBindingCandidate[]> => {
  if (agentIds.length === 0) return [];

  const rows = await ctx.db
    .select({
      agencyConfig: agents.agencyConfig,
      avatar: agents.avatar,
      backgroundColor: agents.backgroundColor,
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      title: agents.title,
      userId: agents.userId,
      visibility: agents.visibility,
      workspaceId: agents.workspaceId,
    })
    .from(agents)
    .where(
      and(
        ctx.ownership(),
        or(eq(agents.slug, INBOX_SESSION_ID), ne(agents.virtual, true)),
        inArray(agents.id, agentIds),
      ),
    );

  return rows.map(({ slug, ...row }) => normalizeInboxAgentMeta(row, { slug }));
};

/**
 * Build the where condition shared by queryAgents / countAgents: the current
 * user's agents, with optional keyword filter.
 *
 * Virtual rows are infrastructure (group-built members, supervisors) and stay
 * excluded. That includes the inbox (Lobe AI): it is the product-owned
 * assistant, so including it is a deliberate choice every caller makes with
 * `includeInbox: true` — never something a generic agent lookup inherits. The
 * default is therefore the long-standing behavior (real, user-created agents
 * only), so callers that never asked for the inbox — older clients, the
 * CRUD/management tool runtimes, group pickers — keep it out instead of
 * discovering a row they cannot delete or add.
 *
 * When a caller does opt in, the inbox joins the page inside the where clause
 * rather than being filtered afterwards, so `limit` is never spent on an inbox
 * the caller would drop.
 */
export const buildQueryAgentsWhere = (
  ctx: AgentModelContext,
  keyword?: string,
  includeInbox = false,
) => {
  // Include agents where virtual is false OR null (legacy data without virtual
  // field), plus the inbox when the caller opts into it.
  const baseConditions = and(
    ctx.ownership(),
    includeInbox
      ? or(eq(agents.virtual, false), isNull(agents.virtual), eq(agents.slug, INBOX_SESSION_ID))
      : or(eq(agents.virtual, false), isNull(agents.virtual)),
  );

  // `name` is the user-facing display name (see `agents.name`); resolving the
  // label the UI shows is the primary way users and tools find an agent, so
  // the keyword must match it alongside `title`/`description`.
  if (!keyword) return baseConditions;

  // An inbox with a blank title is shown as `DEFAULT_INBOX_TITLE` only after
  // the query (see `normalizeInboxAgentMeta`), so the raw `title` column can't
  // match it — match that default label here instead.
  const matchesDefaultInboxTitle =
    includeInbox && DEFAULT_INBOX_TITLE.toLowerCase().includes(keyword.toLowerCase());

  return and(
    baseConditions,
    or(
      ilike(agents.title, `%${keyword}%`),
      ilike(agents.name, `%${keyword}%`),
      ilike(agents.description, `%${keyword}%`),
      matchesDefaultInboxTitle
        ? and(
            eq(agents.slug, INBOX_SESSION_ID),
            or(isNull(agents.title), sql`trim(${agents.title}) = ''`),
          )
        : undefined,
    ),
  );
};

/**
 * Query the user's agents with an optional keyword filter.
 * Returns minimal agent info (id, title, name, description, avatar,
 * backgroundColor), plus `userId`/`visibility` so callers can gate per-agent
 * actions (e.g. transfer is creator/primary-owner only), a compact
 * `heteroType` derived from `agencyConfig` so callers can tell which results
 * are heterogeneous (external CLI/device) agents, and `isInbox` so callers can
 * recognize the product-owned inbox (Lobe AI) without re-deriving it from a
 * slug the row shape no longer carries.
 * Excludes virtual agents (supervisors, group-built members) and, unless the
 * caller opts in with `includeInbox: true`, the product-owned inbox (Lobe AI).
 * See `buildQueryAgentsWhere`.
 */
export const queryAgents = async (
  ctx: AgentModelContext,
  params?: {
    includeInbox?: boolean;
    keyword?: string;
    limit?: number;
    offset?: number;
  },
) => {
  const { includeInbox = false, keyword, limit = 9999, offset = 0 } = params ?? {};
  const searchCondition = buildQueryAgentsWhere(ctx, keyword, includeInbox);

  const rows = await ctx.db
    .select({
      agencyConfig: agents.agencyConfig,
      avatar: agents.avatar,
      backgroundColor: agents.backgroundColor,
      description: agents.description,
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      title: agents.title,
      userId: agents.userId,
      visibility: agents.visibility,
    })
    .from(agents)
    .where(searchCondition)
    .orderBy(desc(agents.updatedAt))
    .limit(limit)
    .offset(offset);

  // Surface only the hetero runtime type, not the full agencyConfig payload.
  return rows.map(({ slug, agencyConfig, ...row }) => ({
    ...normalizeInboxAgentMeta(
      { ...row, heteroType: agencyConfig?.heterogeneousProvider?.type },
      { slug },
    ),
    // When the caller opted in, the inbox is the only virtual row this query
    // keeps, and `slug` is consumed above rather than returned — so the flag
    // is what lets callers pin or annotate Lobe AI without re-deriving it.
    isInbox: slug === INBOX_SESSION_ID,
  }));
};

/**
 * Count the agents matching the same conditions as queryAgents — the inbox is
 * counted only when the caller opts in with `includeInbox: true`, other
 * virtual rows always excluded — so the count stays a faithful total for
 * paginated callers and for the assistants stats.
 * Used to report real totals (and pagination) when queryAgents is limited.
 * Accepts date filters so callers can compare current vs. prior-period totals
 * directly from the agents table.
 */
export const countAgents = async (
  ctx: AgentModelContext,
  params?: {
    endDate?: string;
    includeInbox?: boolean;
    keyword?: string;
    range?: [string, string];
    startDate?: string;
  },
): Promise<number> => {
  const result = await ctx.db
    .select({ count: count() })
    .from(agents)
    .where(
      genWhere([
        buildQueryAgentsWhere(ctx, params?.keyword, params?.includeInbox ?? false),
        params?.range
          ? genRangeWhere(params.range, agents.createdAt, (date) => date.toDate())
          : undefined,
        params?.endDate
          ? genEndDateWhere(params.endDate, agents.createdAt, (date) => date.toDate())
          : undefined,
        params?.startDate
          ? genStartDateWhere(params.startDate, agents.createdAt, (date) => date.toDate())
          : undefined,
      ]),
    );

  /* v8 ignore next -- unreachable: count() without GROUP BY always returns exactly one non-null row */
  return result[0]?.count ?? 0;
};

/**
 * Get minimal agent info (avatar, title, backgroundColor) by IDs.
 * For inbox agent (slug='inbox'), falls back to LobeAI defaults when avatar/title are missing.
 */
export const getAgentAvatarsByIds = async (ctx: AgentModelContext, ids: string[]) => {
  if (ids.length === 0) return [];

  const rows = await ctx.db
    .select({
      avatar: agents.avatar,
      backgroundColor: agents.backgroundColor,
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      title: agents.title,
    })
    .from(agents)
    .where(and(ctx.ownership(), inArray(agents.id, ids)));

  return rows.map(({ slug, ...row }) => normalizeInboxAgentMeta(row, { slug }));
};

/**
 * List agents bindable by the System Bot messenger picker: real agents plus
 * the inbox (other virtual agents excluded), ordered by `updatedAt DESC` with
 * the inbox pinned to the top.
 *
 * Returns `name` and `title` separately — resolving them into one label is the
 * caller's job (see `agentDisplayName`), since only the caller knows whether it
 * can render an i18n fallback. `title` is still normalized here for the inbox
 * (LobeAI default) and falls back to `options.fallbackTitle` when blank
 * (default `null`, so a client caller can supply its own i18n default).
 */
export const listMessengerBindableAgents = async (
  ctx: AgentModelContext,
  options?: {
    fallbackTitle?: string | null;
  },
): Promise<
  Array<{
    avatar: string | null;
    backgroundColor: string | null;
    id: string;
    isInbox: boolean;
    isPrivate: boolean;
    name: string | null;
    title: string | null;
  }>
> => {
  const fallbackTitle = options?.fallbackTitle ?? null;

  const rows = await ctx.db
    .select({
      avatar: agents.avatar,
      backgroundColor: agents.backgroundColor,
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      title: agents.title,
      visibility: agents.visibility,
    })
    .from(agents)
    .where(and(ctx.ownership(), or(ne(agents.virtual, true), eq(agents.slug, INBOX_SESSION_ID))))
    .orderBy(desc(agents.updatedAt));

  const normalized = rows
    .filter((row) => row.id)
    .map(({ slug, visibility, ...row }) => {
      const meta = normalizeInboxAgentMeta(row, { slug });
      return {
        avatar: meta.avatar,
        backgroundColor: meta.backgroundColor,
        id: meta.id,
        isInbox: slug === INBOX_SESSION_ID,
        // Only meaningful in workspace mode: the ownership predicate already
        // scopes visible private rows to the caller, so `isPrivate` means
        // "the caller's own private agent in this workspace". Personal-mode
        // rows are all implicitly private, so the flag stays false there to
        // signal "no grouping needed".
        isPrivate: Boolean(ctx.workspaceId) && visibility === 'private',
        name: meta.name ?? null,
        // The inbox title is already resolved by normalizeInboxAgentMeta; any
        // other blank title falls back to the caller-provided default.
        title: meta.title?.trim() || fallbackTitle,
      };
    });

  // Pin the inbox agent to the top regardless of updatedAt — it's the
  // implicit "default" agent and should always be the first option.
  const inboxIdx = normalized.findIndex((row) => row.isInbox);
  if (inboxIdx > 0) {
    const [inbox] = normalized.splice(inboxIdx, 1);
    normalized.unshift(inbox);
  }

  return normalized;
};
