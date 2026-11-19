import type { SkillItem, SkillListItem } from '@lobechat/types';
import { merge } from '@lobechat/utils';
import { and, desc, eq, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm';

import type { NewAgentSkill } from '../schemas';
import { agentSkills } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

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
  upstream: agentSkills.upstream,
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
  upstream: agentSkills.upstream,
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

  // ========== Create ==========

  create = async (data: Omit<NewAgentSkill, 'userId' | 'workspaceId'>): Promise<SkillItem> => {
    const [result] = await this.db
      .insert(agentSkills)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, data))
      .returning(skillItemColumns);
    return result;
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

  findGitHubInstalls = async (): Promise<SkillItem[]> =>
    this.db
      .select(skillItemColumns)
      .from(agentSkills)
      .where(
        and(
          this.scopeWhere(),
          or(
            isNotNull(agentSkills.upstream),
            and(
              eq(agentSkills.source, 'market'),
              sql`COALESCE(${agentSkills.manifest}->>'sourceUrl', '') <> ''`,
            ),
          ),
        ),
      );

  findImportMatches = async (identifiers: string[], names: string[]): Promise<SkillItem[]> =>
    this.db
      .select(skillItemColumns)
      .from(agentSkills)
      .where(
        and(
          this.scopeWhere(),
          or(
            inArray(agentSkills.identifier, identifiers),
            inArray(
              sql`lower(${agentSkills.name})`,
              names.map((name) => name.toLowerCase()),
            ),
          ),
        ),
      );

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
    // Editors merge partial manifest fields. Read under a row lock so this
    // merge cannot restore a previous package after a concurrent GitHub update.
    return this.db.transaction(async (tx) => {
      const where = and(eq(agentSkills.id, id), this.scopeWhere());
      const [existing] = await tx
        .select(skillItemColumns)
        .from(agentSkills)
        .where(where)
        .for('update');
      const updateData = merge(existing || {}, { ...data, updatedAt: new Date() });
      const [result] = await tx
        .update(agentSkills)
        .set(updateData)
        .where(where)
        .returning(skillItemColumns);
      return result;
    });
  };

  // Serialize GitHub create/name decisions within a library. Only final row
  // writes take this lock; archive downloads and object uploads run outside it.
  withImportLock = <T>(write: (model: AgentSkillModel) => Promise<T>) =>
    this.db.transaction(async (tx) => {
      const scope = this.workspaceId ? `workspace:${this.workspaceId}` : `user:${this.userId}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'skill-import:' + scope}))`);
      return write(new AgentSkillModel(tx, this.userId, this.workspaceId));
    });

  replaceImportedSkill = async (existing: SkillItem, data: Partial<NewAgentSkill>) => {
    const [row] = await this.db
      .update(agentSkills)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          this.scopeWhere(),
          eq(agentSkills.id, existing.id),
          sql`date_trunc('milliseconds', ${agentSkills.updatedAt}) = ${existing.updatedAt.toISOString()}::timestamptz`,
        ),
      )
      .returning(skillItemColumns);
    return row;
  };

  // ========== Delete ==========

  delete = async (id: string): Promise<{ success: boolean }> => {
    const result = await this.db
      .delete(agentSkills)
      .where(and(eq(agentSkills.id, id), this.scopeWhere()));

    return { success: (result.rowCount ?? 0) > 0 };
  };
}
