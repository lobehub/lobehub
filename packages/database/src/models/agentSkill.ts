import { INBOX_SESSION_ID } from '@lobechat/const';
import type { AgentPluginEntry, SkillItem, SkillListItem } from '@lobechat/types';
import { parsePluginEntry } from '@lobechat/types';
import { merge } from '@lobechat/utils';
import { and, desc, eq, ilike, inArray, isNull, ne, notExists, or, sql } from 'drizzle-orm';

import type { NewAgentSkill } from '../schemas';
import {
  agents,
  agentSkills,
  agentsToSessions,
  sessions,
  userConnectors,
  userInstalledPlugins,
  users,
  workspaces,
} from '../schemas';
import type { LobeChatDatabase, Transaction } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

interface AgentSkillScope {
  userId: string;
  workspaceId?: string;
}

export const removeAgentPluginPolicyEntries = async (
  executor: LobeChatDatabase,
  scope: AgentSkillScope,
  identifier: string,
  agentId?: string,
) => {
  const agentScope = buildWorkspaceWhere(scope, {
    userId: agents.userId,
    workspaceId: agents.workspaceId,
  });
  const skillScope = buildWorkspaceWhere(scope, agentSkills);
  const pluginScope = buildWorkspaceWhere(scope, userInstalledPlugins);
  const connectorScope = buildWorkspaceWhere(scope, userConnectors);

  await executor.execute(sql`
    update ${agents}
    set ${sql.identifier('plugins')} = (
      select coalesce(jsonb_agg(plugin.entry order by plugin.ordinality), '[]'::jsonb)
      from jsonb_array_elements(coalesce(${agents.plugins}, '[]'::jsonb))
        with ordinality as plugin(entry, ordinality)
      where plugin.entry #>> '{}' is distinct from ${identifier}
        and plugin.entry ->> 'identifier' is distinct from ${identifier}
    )
    where ${and(agentScope, agentId ? eq(agents.id, agentId) : undefined)}
      and not exists (
        select 1
        from ${agentSkills}
        where ${and(skillScope, eq(agentSkills.identifier, identifier))}
      )
      and not exists (
        select 1
        from ${userInstalledPlugins}
        where ${and(pluginScope, eq(userInstalledPlugins.identifier, identifier))}
      )
      and not exists (
        select 1
        from ${userConnectors}
        where ${and(
          connectorScope,
          eq(userConnectors.identifier, identifier),
          or(isNull(userConnectors.agentId), eq(userConnectors.agentId, agents.id)),
        )}
      )
      and exists (
        select 1
        from jsonb_array_elements(coalesce(${agents.plugins}, '[]'::jsonb)) as plugin(entry)
        where plugin.entry #>> '{}' = ${identifier}
           or plugin.entry ->> 'identifier' = ${identifier}
      )
  `);
};

// Agent and skill creation take the same parent-row lock so overlapping
// transactions cannot each miss the other's still-uncommitted row.
export const lockAgentSkillScope = async (trx: Transaction, scope: AgentSkillScope) => {
  if (scope.workspaceId) {
    await trx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, scope.workspaceId))
      .for('update');
    return;
  }

  await trx.select({ id: users.id }).from(users).where(eq(users.id, scope.userId)).for('update');
};

export const getScopedAgentSkillIdentifiers = async (
  executor: LobeChatDatabase,
  scope: AgentSkillScope,
): Promise<string[]> => {
  const rows = await executor
    .select({ identifier: agentSkills.identifier })
    .from(agentSkills)
    .where(buildWorkspaceWhere(scope, agentSkills));

  return rows.map(({ identifier }) => identifier);
};

export const appendDisabledAgentSkillDefaults = (
  plugins: AgentPluginEntry[] | null | undefined,
  skillIdentifiers: string[],
): AgentPluginEntry[] | undefined => {
  if (skillIdentifiers.length === 0) return plugins ?? undefined;

  const next = plugins ? [...plugins] : [];
  const configuredIdentifiers = new Set(next.map((entry) => parsePluginEntry(entry).identifier));

  for (const identifier of skillIdentifiers) {
    if (configuredIdentifiers.has(identifier)) continue;
    next.push({ identifier, mode: 'disabled' });
    configuredIdentifiers.add(identifier);
  }

  return next;
};

export const isInboxAgentRecord = async (executor: LobeChatDatabase, agentId: string) => {
  const [agent] = await executor
    .select({ slug: agents.slug })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (agent?.slug === INBOX_SESSION_ID) return true;

  const [inboxSession] = await executor
    .select({ agentId: agentsToSessions.agentId })
    .from(agentsToSessions)
    .innerJoin(sessions, eq(sessions.id, agentsToSessions.sessionId))
    .where(and(eq(agentsToSessions.agentId, agentId), eq(sessions.slug, INBOX_SESSION_ID)))
    .limit(1);

  return !!inboxSession;
};

const skillItemColumns = {
  content: agentSkills.content,
  createdAt: agentSkills.createdAt,
  description: agentSkills.description,
  editorData: agentSkills.editorData,
  id: agentSkills.id,
  identifier: agentSkills.identifier,
  manifest: agentSkills.manifest,
  name: agentSkills.name,
  resources: agentSkills.resources,
  source: agentSkills.source,
  updatedAt: agentSkills.updatedAt,
  // Creator attribution — row-level ownership checks in workspace mode.
  userId: agentSkills.userId,
  zipFileHash: agentSkills.zipFileHash,
};

const skillListColumns = {
  createdAt: agentSkills.createdAt,
  description: agentSkills.description,
  id: agentSkills.id,
  identifier: agentSkills.identifier,
  manifest: agentSkills.manifest,
  name: agentSkills.name,
  source: agentSkills.source,
  updatedAt: agentSkills.updatedAt,
  // Creator attribution — row-level ownership checks in workspace mode.
  userId: agentSkills.userId,
  zipFileHash: agentSkills.zipFileHash,
};

export class AgentSkillModel {
  private userId: string;
  private workspaceId?: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private scopeWhere = () =>
    buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agentSkills);

  // Workspace skills are shared, so initialize every agent in the workspace,
  // including private agents owned by other members.
  private agentScopeWhere = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      { userId: agents.userId, workspaceId: agents.workspaceId },
    );

  // ========== Create ==========

  create = async (data: Omit<NewAgentSkill, 'userId' | 'workspaceId'>): Promise<SkillItem> => {
    return this.db.transaction(async (trx) => {
      await lockAgentSkillScope(trx, { userId: this.userId, workspaceId: this.workspaceId });

      const [result] = await trx
        .insert(agentSkills)
        .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, data))
        .returning(skillItemColumns);

      // Keep inbox on the implicit `auto` default. For every other existing agent,
      // atomically append a disabled entry only when the identifier is absent.
      // This is one set-based UPDATE, so concurrent skill imports retain each
      // other's entries and existing user-selected modes are left untouched.
      await trx.execute(sql`
        update ${agents}
        set ${sql.identifier('plugins')} =
          coalesce(${agents.plugins}, '[]'::jsonb)
          || jsonb_build_array(
            jsonb_build_object('identifier', (${data.identifier})::text, 'mode', 'disabled')
          )
        where ${and(
          this.agentScopeWhere(),
          or(isNull(agents.slug), ne(agents.slug, INBOX_SESSION_ID)),
          // Historical inbox agents may only be identifiable through their
          // linked session, before getBuiltinAgent backfills agents.slug.
          notExists(
            trx
              .select({ agentId: agentsToSessions.agentId })
              .from(agentsToSessions)
              .innerJoin(sessions, eq(sessions.id, agentsToSessions.sessionId))
              .where(
                and(eq(agentsToSessions.agentId, agents.id), eq(sessions.slug, INBOX_SESSION_ID)),
              ),
          ),
          sql`not exists (
              select 1
              from jsonb_array_elements(coalesce(${agents.plugins}, '[]'::jsonb)) as plugin(entry)
              where plugin.entry #>> '{}' = ${data.identifier}
                 or plugin.entry ->> 'identifier' = ${data.identifier}
            )`,
        )}
      `);

      return result;
    });
  };

  // ========== Read ==========

  findById = async (id: string): Promise<SkillItem | undefined> => {
    const [result] = await this.db
      .select(skillItemColumns)
      .from(agentSkills)
      .where(and(eq(agentSkills.id, id), this.scopeWhere()))
      .limit(1);
    return result;
  };

  findByIdentifier = async (identifier: string): Promise<SkillItem | undefined> => {
    const [result] = await this.db
      .select(skillItemColumns)
      .from(agentSkills)
      .where(and(eq(agentSkills.identifier, identifier), this.scopeWhere()))
      .limit(1);
    return result;
  };

  findByName = async (name: string): Promise<SkillItem | undefined> => {
    const [result] = await this.db
      .select(skillItemColumns)
      .from(agentSkills)
      .where(and(sql`lower(${agentSkills.name}) = ${name.toLowerCase()}`, this.scopeWhere()))
      .limit(1);
    return result;
  };

  findAll = async (): Promise<{ data: SkillListItem[]; total: number }> => {
    const data = await this.db
      .select(skillListColumns)
      .from(agentSkills)
      .where(this.scopeWhere())
      .orderBy(desc(agentSkills.updatedAt));

    return { data, total: data.length };
  };

  findByIds = async (ids: string[]): Promise<SkillItem[]> => {
    if (ids.length === 0) return [];
    return this.db
      .select(skillItemColumns)
      .from(agentSkills)
      .where(and(inArray(agentSkills.id, ids), this.scopeWhere()));
  };

  listBySource = async (
    source: 'builtin' | 'market' | 'user',
  ): Promise<{ data: SkillListItem[]; total: number }> => {
    const data = await this.db
      .select(skillListColumns)
      .from(agentSkills)
      .where(and(eq(agentSkills.source, source), this.scopeWhere()))
      .orderBy(desc(agentSkills.updatedAt));

    return { data, total: data.length };
  };

  search = async (query: string): Promise<{ data: SkillListItem[]; total: number }> => {
    const data = await this.db
      .select(skillListColumns)
      .from(agentSkills)
      .where(
        and(
          this.scopeWhere(),
          or(ilike(agentSkills.name, `%${query}%`), ilike(agentSkills.description, `%${query}%`)),
        ),
      )
      .orderBy(desc(agentSkills.updatedAt));

    return { data, total: data.length };
  };

  // ========== Update ==========

  update = async (id: string, data: Partial<NewAgentSkill>): Promise<SkillItem> => {
    const existing = await this.findById(id);

    const updateData = merge(existing || {}, { ...data, updatedAt: new Date() });

    const [result] = await this.db
      .update(agentSkills)
      .set(updateData)
      .where(and(eq(agentSkills.id, id), this.scopeWhere()))
      .returning(skillItemColumns);
    return result;
  };

  // ========== Delete ==========

  delete = async (id: string): Promise<{ success: boolean }> => {
    return this.db.transaction(async (trx) => {
      const scope = { userId: this.userId, workspaceId: this.workspaceId };
      await lockAgentSkillScope(trx, scope);
      const [deleted] = await trx
        .delete(agentSkills)
        .where(and(eq(agentSkills.id, id), this.scopeWhere()))
        .returning({ identifier: agentSkills.identifier });

      if (!deleted) return { success: false };

      await removeAgentPluginPolicyEntries(trx, scope, deleted.identifier);

      return { success: true };
    });
  };
}
