import { and, eq, notExists } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { AgentModel } from '../../models/agent';
import { ProjectModel, type ProjectModelOptions } from '../../models/project';
import {
  acceptanceComments,
  agentDocuments,
  agentOperations,
  briefs,
  dashboards,
  goalNodeDecisions,
  goalNodes,
  goals,
  messages,
  taskActivities,
  taskComments,
  tasks,
  threads,
  topics,
  widgets,
  widgetVersions,
  works,
  workVersions,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';

/**
 * Hands a project to another main agent. Retiring a dedicated coordinator moves
 * its record of work to the successor and deletes the agent, which spans the
 * conversation, task, work, goal, widget and document aggregates — so the unit
 * of work lives here and composes {@link ProjectModel} and {@link AgentModel}.
 */
export class ProjectCoordinatorRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
    private readonly options: ProjectModelOptions = {},
  ) {}

  /**
   * The new main agent joins as a member. A dedicated coordinator passes its
   * history on and is deleted; a reusable predecessor stays a plain member.
   */
  async replaceCoordinator(projectId: string, agentId: string) {
    return this.db.transaction(async (trx) => {
      const tx = trx as LobeChatDatabase;
      const projectModel = new ProjectModel(tx, this.userId, this.workspaceId, this.options);
      const assigned = await projectModel.assignCoordinator(projectId, agentId);
      if (!assigned) return null;

      const { previousId, project } = assigned;
      if (
        previousId &&
        (await projectModel.isDedicatedCoordinator(previousId, { exceptProjectId: projectId }))
      ) {
        await this.transferHistory(tx, previousId, agentId);
        await new AgentModel(tx, this.userId, this.workspaceId).delete(previousId);
      }
      return project;
    });
  }

  /**
   * Everything a deleted agent would take with it (`ON DELETE CASCADE`) or leave
   * unattributed (`SET NULL`) that belongs to the project's record of work.
   */
  private async transferHistory(db: LobeChatDatabase, fromId: string, toId: string) {
    await db.update(topics).set({ agentId: toId }).where(eq(topics.agentId, fromId));
    await db.update(threads).set({ agentId: toId }).where(eq(threads.agentId, fromId));
    await db.update(messages).set({ agentId: toId }).where(eq(messages.agentId, fromId));
    // `target_id` has no foreign key; a user turn addressed to the coordinator
    // would drop out of the successor's thread view if it kept the old id.
    await db.update(messages).set({ targetId: toId }).where(eq(messages.targetId, fromId));
    await db.update(tasks).set({ assigneeAgentId: toId }).where(eq(tasks.assigneeAgentId, fromId));
    await db
      .update(tasks)
      .set({ createdByAgentId: toId })
      .where(eq(tasks.createdByAgentId, fromId));
    await db
      .update(taskComments)
      .set({ authorAgentId: toId })
      .where(eq(taskComments.authorAgentId, fromId));
    await db
      .update(taskActivities)
      .set({ actorAgentId: toId })
      .where(eq(taskActivities.actorAgentId, fromId));
    await db.update(briefs).set({ agentId: toId }).where(eq(briefs.agentId, fromId));
    await db.update(works).set({ originAgentId: toId }).where(eq(works.originAgentId, fromId));
    await db.update(workVersions).set({ agentId: toId }).where(eq(workVersions.agentId, fromId));
    await db.update(goals).set({ agentId: toId }).where(eq(goals.agentId, fromId));
    await db
      .update(goalNodes)
      .set({ createdByAgentId: toId })
      .where(eq(goalNodes.createdByAgentId, fromId));
    await db
      .update(goalNodeDecisions)
      .set({ resolvedByAgentId: toId })
      .where(eq(goalNodeDecisions.resolvedByAgentId, fromId));
    await db.update(widgets).set({ agentId: toId }).where(eq(widgets.agentId, fromId));
    await db
      .update(widgetVersions)
      .set({ sourceAgentId: toId })
      .where(eq(widgetVersions.sourceAgentId, fromId));
    await db.update(dashboards).set({ agentId: toId }).where(eq(dashboards.agentId, fromId));
    await db
      .update(acceptanceComments)
      .set({ authorAgentId: toId })
      .where(eq(acceptanceComments.authorAgentId, fromId));
    await db
      .update(agentOperations)
      .set({ agentId: toId })
      .where(eq(agentOperations.agentId, fromId));

    // The documents its works point at. A document the new agent already holds
    // keeps that binding; the duplicate goes with the coordinator.
    const held = alias(agentDocuments, 'held');
    await db
      .update(agentDocuments)
      .set({ agentId: toId, updatedAt: new Date() })
      .where(
        and(
          eq(agentDocuments.agentId, fromId),
          notExists(
            db
              .select({ id: held.id })
              .from(held)
              .where(
                and(
                  eq(held.agentId, toId),
                  eq(held.documentId, agentDocuments.documentId),
                  eq(held.userId, agentDocuments.userId),
                ),
              ),
          ),
        ),
      );
  }
}
