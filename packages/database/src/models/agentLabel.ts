import { and, asc, count, eq, inArray, not } from 'drizzle-orm';

import type { AgentLabelItem } from '../schemas';
import { agentLabelAssignments, agentLabels, agents } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export interface AgentLabelWithUsage extends AgentLabelItem {
  usageCount: number;
}

export class AgentLabelModel {
  private userId: string;
  private db: LobeChatDatabase;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.userId = userId;
    this.db = db;
    this.workspaceId = workspaceId;
  }

  // Labels are a workspace-level registry: every member sees and shares the
  // same label set (no per-member visibility). Personal mode falls back to
  // `user_id = ? AND workspace_id IS NULL`.
  private ownership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      { userId: agentLabels.userId, workspaceId: agentLabels.workspaceId },
    );

  private assignmentOwnership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      { userId: agentLabelAssignments.userId, workspaceId: agentLabelAssignments.workspaceId },
    );

  private agentOwnership = () =>
    buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      { userId: agents.userId, workspaceId: agents.workspaceId, visibility: agents.visibility },
    );

  query = async (): Promise<AgentLabelWithUsage[]> => {
    const rows = await this.db
      .select({
        accessedAt: agentLabels.accessedAt,
        archived: agentLabels.archived,
        color: agentLabels.color,
        createdAt: agentLabels.createdAt,
        description: agentLabels.description,
        id: agentLabels.id,
        name: agentLabels.name,
        updatedAt: agentLabels.updatedAt,
        usageCount: count(agents.id),
        userId: agentLabels.userId,
        workspaceId: agentLabels.workspaceId,
      })
      .from(agentLabels)
      // The usage total must only count agents the caller can actually see.
      // Counting assignment rows alone would report how many of a teammate's
      // private agents carry a shared label — a number the agents list itself
      // never reveals. Joining through `agents` under the same visibility
      // predicate keeps the count consistent with what the list shows.
      .leftJoin(agentLabelAssignments, eq(agentLabelAssignments.labelId, agentLabels.id))
      .leftJoin(
        agents,
        and(
          eq(agents.id, agentLabelAssignments.agentId),
          not(eq(agents.virtual, true)),
          this.agentOwnership(),
        ),
      )
      .where(this.ownership())
      .groupBy(agentLabels.id)
      .orderBy(asc(agentLabels.name));

    return rows;
  };

  findById = async (id: string) => {
    const [result] = await this.db
      .select()
      .from(agentLabels)
      .where(and(eq(agentLabels.id, id), this.ownership()))
      .limit(1);

    return result;
  };

  create = async (params: { color?: string; description?: string; name: string }) => {
    const [result] = await this.db
      .insert(agentLabels)
      .values(buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, params))
      .returning();

    return result;
  };

  update = async (
    id: string,
    value: Partial<Pick<AgentLabelItem, 'archived' | 'color' | 'description' | 'name'>>,
  ) => {
    return this.db
      .update(agentLabels)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(agentLabels.id, id), this.ownership()));
  };

  delete = async (id: string) => {
    return this.db.delete(agentLabels).where(and(eq(agentLabels.id, id), this.ownership()));
  };

  /**
   * Label ids currently assigned to an agent (scope-checked on the junction).
   */
  getAgentLabelIds = async (agentId: string): Promise<string[]> => {
    const rows = await this.db
      .select({ labelId: agentLabelAssignments.labelId })
      .from(agentLabelAssignments)
      .where(and(eq(agentLabelAssignments.agentId, agentId), this.assignmentOwnership()));

    return rows.map((row) => row.labelId);
  };

  /**
   * Apply or remove a single label. Preferred over `setAgentLabels` wherever
   * the caller expresses one toggle: a full replacement built from a client's
   * cached assignment set silently drops whatever another editor added since
   * that cache was filled. Mirrors the add/remove pairs used for the other
   * many-to-many memberships (knowledge-base files, chat-group agents).
   */
  toggleAgentLabel = async (agentId: string, labelId: string, assigned: boolean) => {
    await this.assertAgentInScope(agentId);

    if (!assigned) {
      await this.db
        .delete(agentLabelAssignments)
        .where(
          and(
            eq(agentLabelAssignments.agentId, agentId),
            eq(agentLabelAssignments.labelId, labelId),
            this.assignmentOwnership(),
          ),
        );

      return this.getAgentLabelIds(agentId);
    }

    const [label] = await this.db
      .select({ archived: agentLabels.archived, id: agentLabels.id })
      .from(agentLabels)
      .where(and(eq(agentLabels.id, labelId), this.ownership()))
      .limit(1);

    if (!label) throw new Error(`Agent label not found in current scope: ${labelId}`);
    // Archived labels are retired: existing assignments survive, new ones are
    // refused rather than silently ignored, matching `setAgentLabels`.
    if (label.archived) throw new Error(`Agent label is archived: ${labelId}`);

    await this.db
      .insert(agentLabelAssignments)
      .values(
        buildWorkspacePayload(
          { userId: this.userId, workspaceId: this.workspaceId },
          { agentId, labelId },
        ),
      )
      .onConflictDoNothing();

    return this.getAgentLabelIds(agentId);
  };

  private assertAgentInScope = async (agentId: string) => {
    const [agent] = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.id, agentId),
          // Virtual agents — chat-group supervisors and synthetic members — are
          // filtered out of the agents list entirely, so a label on one could
          // never be seen while still inflating that label's usage count.
          not(eq(agents.virtual, true)),
          this.agentOwnership(),
        ),
      )
      .limit(1);

    if (!agent) throw new Error(`Agent ${agentId} not found in current scope`);
  };

  /**
   * Replace the full label set of an agent. Only labels that exist in the
   * current scope can be applied; archived labels stay applied if already
   * assigned but cannot be newly added.
   */
  setAgentLabels = async (agentId: string, labelIds: string[]) => {
    // The agent itself must be visible in the current scope.
    await this.assertAgentInScope(agentId);

    const currentIds = new Set(await this.getAgentLabelIds(agentId));

    const scopedLabels =
      labelIds.length > 0
        ? await this.db
            .select({ archived: agentLabels.archived, id: agentLabels.id })
            .from(agentLabels)
            .where(and(inArray(agentLabels.id, labelIds), this.ownership()))
        : [];

    // Silently dropping ids the caller cannot see would turn a partial
    // mismatch into a destructive write: this is a full replacement, so an
    // unresolvable id shrinks `nextIds` and deletes assignments the caller
    // never meant to touch. A client holding another scope's registry (mid
    // workspace switch) would wipe the agent's labels. Fail loudly instead.
    const scopedIds = new Set(scopedLabels.map((label) => label.id));
    const unknownIds = labelIds.filter((id) => !scopedIds.has(id));
    if (unknownIds.length > 0)
      throw new Error(`Agent labels not found in current scope: ${unknownIds.join(', ')}`);

    const nextIds = scopedLabels
      .filter((label) => !label.archived || currentIds.has(label.id))
      .map((label) => label.id);

    const toRemove = [...currentIds].filter((id) => !nextIds.includes(id));
    const toAdd = nextIds.filter((id) => !currentIds.has(id));

    await this.db.transaction(async (tx) => {
      if (toRemove.length > 0) {
        await tx
          .delete(agentLabelAssignments)
          .where(
            and(
              eq(agentLabelAssignments.agentId, agentId),
              inArray(agentLabelAssignments.labelId, toRemove),
              this.assignmentOwnership(),
            ),
          );
      }

      if (toAdd.length > 0) {
        await tx
          .insert(agentLabelAssignments)
          .values(
            toAdd.map((labelId) =>
              buildWorkspacePayload(
                { userId: this.userId, workspaceId: this.workspaceId },
                { agentId, labelId },
              ),
            ),
          );
      }
    });

    return nextIds;
  };
}
