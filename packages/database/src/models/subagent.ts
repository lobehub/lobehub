import type { CreateSubagentParams, SubagentItem, UpdateSubagentParams } from '@lobechat/types';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { agents, subagents } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

const PG_UNIQUE_VIOLATION = '23505';

const isUniqueViolation = (error: unknown): boolean =>
  !!error &&
  typeof error === 'object' &&
  (('code' in error && (error as { code?: string }).code === PG_UNIQUE_VIOLATION) ||
    ('cause' in error && isUniqueViolation((error as { cause?: unknown }).cause)));

/** Thrown when a parent agent already has a subagent preset with the same name. */
export class SubagentNameConflictError extends Error {
  constructor(name: string) {
    super(`A subagent named "${name}" already exists for this agent`);
    this.name = 'SubagentNameConflictError';
  }
}

/** Thrown when the parent agent does not exist or the caller cannot see it. */
export class SubagentParentNotFoundError extends Error {
  constructor(parentAgentId: string) {
    super(`Parent agent ${parentAgentId} not found`);
    this.name = 'SubagentParentNotFoundError';
  }
}

const itemColumns = {
  createdAt: subagents.createdAt,
  description: subagents.description,
  id: subagents.id,
  isEnabled: subagents.isEnabled,
  model: subagents.model,
  name: subagents.name,
  parentAgentId: subagents.parentAgentId,
  provider: subagents.provider,
  reasoningEffort: subagents.reasoningEffort,
  systemRole: subagents.systemRole,
  tools: subagents.tools,
  updatedAt: subagents.updatedAt,
};

/**
 * CRUD for subagent presets. Presets live in their own table, so none of the
 * agent list / market / share reads can pick them up; they are only ever read
 * by `parentAgentId` or by id. Access always derives from the parent agent:
 * a preset is reachable exactly when its parent agent is.
 */
export class SubagentModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  private agentOwnership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        isDeleted: agents.isDeleted,
        userId: agents.userId,
        visibility: agents.visibility,
        workspaceId: agents.workspaceId,
      },
    );

  private visibleAgentIds = () =>
    this.db.select({ id: agents.id }).from(agents).where(this.agentOwnership());

  private selectItems = () =>
    this.db
      .select(itemColumns)
      .from(subagents)
      .innerJoin(agents, eq(agents.id, subagents.parentAgentId));

  create = async ({ parentAgentId, ...params }: CreateSubagentParams): Promise<SubagentItem> => {
    const [parent] = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, parentAgentId), this.agentOwnership()))
      .limit(1);
    if (!parent) throw new SubagentParentNotFoundError(parentAgentId);

    try {
      const [row] = await this.db
        .insert(subagents)
        .values({ ...params, parentAgentId })
        .returning({ id: subagents.id });
      return (await this.findById(row.id))!;
    } catch (error) {
      if (isUniqueViolation(error)) throw new SubagentNameConflictError(params.name);
      throw error;
    }
  };

  findById = async (id: string): Promise<SubagentItem | undefined> => {
    const [row] = await this.selectItems()
      .where(and(eq(subagents.id, id), this.agentOwnership()))
      .limit(1);
    return row;
  };

  queryByParentAgentId = async (parentAgentId: string): Promise<SubagentItem[]> => {
    return this.selectItems()
      .where(and(eq(subagents.parentAgentId, parentAgentId), this.agentOwnership()))
      .orderBy(asc(subagents.createdAt), asc(subagents.id));
  };

  update = async (id: string, value: UpdateSubagentParams): Promise<SubagentItem | undefined> => {
    try {
      const [row] = await this.db
        .update(subagents)
        .set({ ...value, updatedAt: new Date() })
        .where(and(eq(subagents.id, id), inArray(subagents.parentAgentId, this.visibleAgentIds())))
        .returning({ id: subagents.id });
      return row && this.findById(row.id);
    } catch (error) {
      if (isUniqueViolation(error)) throw new SubagentNameConflictError(value.name ?? '');
      throw error;
    }
  };

  /**
   * Deletes the preset only. Threads it ran keep their history: the
   * `threads.subagent_id` foreign key is `ON DELETE SET NULL`.
   */
  delete = async (id: string) => {
    return this.db
      .delete(subagents)
      .where(and(eq(subagents.id, id), inArray(subagents.parentAgentId, this.visibleAgentIds())));
  };
}
