import { INBOX_SESSION_ID } from '@lobechat/const';
import { type AgentPluginEntry, type AgentPluginMode, getPluginMode } from '@lobechat/types';
import { and, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';

import { agents } from '../../schemas';
import { type AgentModelContext } from './context';

export interface AgentPluginModeItem {
  agentId: string;
  /** Only the explicit states: an agent without an entry is `auto` and not listed. */
  mode: Exclude<AgentPluginMode, 'auto'>;
}

/**
 * `agents.plugins` mixes legacy bare identifiers with `{ identifier, mode }`
 * objects, so "carries the plugin" is one containment test per shape. Both
 * are plain `@>` checks a GIN index on `plugins` could serve.
 */
const carriesPlugin = (identifier: string): SQL =>
  sql`(${agents.plugins} @> ${JSON.stringify([identifier])}::jsonb OR ${agents.plugins} @> ${JSON.stringify([{ identifier }])}::jsonb)`;

/** One `plugins[]` element (aliased `e`) that names `identifier`, in either shape. */
const isEntryFor = (identifier: string): SQL =>
  sql`(e.value = to_jsonb(${identifier}::text) OR (jsonb_typeof(e.value) = 'object' AND e.value->>'identifier' = ${identifier}))`;

/**
 * The caller's own LobeHub agents: created by them (not just visible in the
 * workspace), real agents plus the inbox, and not heterogeneous — external
 * runtimes (Claude Code, Codex, …) do not run plugins or skills.
 */
const ownPluginAgents = (ctx: AgentModelContext): SQL | undefined =>
  and(
    ctx.ownership(),
    eq(agents.userId, ctx.userId),
    or(isNull(agents.virtual), eq(agents.virtual, false), eq(agents.slug, INBOX_SESSION_ID)),
    sql`COALESCE(jsonb_typeof(${agents.agencyConfig}->'heterogeneousProvider'), '') <> 'object'`,
  );

/**
 * Which of the caller's agents carry a plugin or skill, and in which mode —
 * one query over `plugins`, instead of loading every agent's full config.
 */
export const listPluginModes = async (
  ctx: AgentModelContext,
  identifier: string,
): Promise<AgentPluginModeItem[]> => {
  const rows = await ctx.db
    .select({ id: agents.id, plugins: agents.plugins })
    .from(agents)
    .where(and(ownPluginAgents(ctx), carriesPlugin(identifier)));

  return rows.flatMap(({ id, plugins }) => {
    const mode = getPluginMode(plugins ?? undefined, identifier);
    return mode === 'auto' ? [] : [{ agentId: id, mode }];
  });
};

/**
 * Sets a plugin's mode on several agents in one statement, rewriting
 * `plugins` in the database so a concurrent write to another entry of the
 * same list is never overwritten by a stale client copy.
 *
 * - `auto` drops every entry for the identifier (absence is `auto`). Without
 *   `agentIds` it applies to every own agent carrying it: "remove from all".
 * - `pinned` / `disabled` rewrite the existing entry in place (a legacy string
 *   becomes an object) or append one; `agentIds` is required.
 *
 * Returns the rows written with their new `plugins`.
 */
export const setPluginMode = async (
  ctx: AgentModelContext,
  identifier: string,
  mode: AgentPluginMode,
  agentIds?: string[],
): Promise<{ id: string; plugins: AgentPluginEntry[] }[]> => {
  if (agentIds?.length === 0) return [];
  if (mode !== 'auto' && !agentIds) throw new Error('setPluginMode: agentIds is required');

  const current = sql`CASE WHEN jsonb_typeof(${agents.plugins}) = 'array' THEN ${agents.plugins} ELSE '[]'::jsonb END`;

  const next =
    mode === 'auto'
      ? sql`(SELECT coalesce(jsonb_agg(e.value ORDER BY e.ord), '[]'::jsonb)
             FROM jsonb_array_elements(${current}) WITH ORDINALITY AS e(value, ord)
             WHERE NOT ${isEntryFor(identifier)})`
      : sql`CASE WHEN ${carriesPlugin(identifier)}
          THEN (SELECT jsonb_agg(
                  CASE WHEN NOT ${isEntryFor(identifier)} THEN e.value
                       WHEN jsonb_typeof(e.value) = 'object' THEN e.value || jsonb_build_object('mode', ${mode}::text)
                       ELSE jsonb_build_object('identifier', e.value, 'mode', ${mode}::text) END
                  ORDER BY e.ord)
                FROM jsonb_array_elements(${current}) WITH ORDINALITY AS e(value, ord))
          ELSE ${current} || jsonb_build_array(jsonb_build_object('identifier', ${identifier}::text, 'mode', ${mode}::text))
        END`;

  const rows = await ctx.db
    .update(agents)
    .set({ plugins: next as unknown as AgentPluginEntry[] })
    .where(
      and(
        ownPluginAgents(ctx),
        agentIds ? inArray(agents.id, agentIds) : undefined,
        // Removing touches only rows that carry the plugin.
        mode === 'auto' ? carriesPlugin(identifier) : undefined,
      ),
    )
    .returning({ id: agents.id, plugins: agents.plugins });

  return rows.map(({ id, plugins }) => ({ id, plugins: (plugins ?? []) as AgentPluginEntry[] }));
};
