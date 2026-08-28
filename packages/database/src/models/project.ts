import { createProjectCoordinatorAgentConfig } from '@lobechat/builtin-agents';
import type { ProjectStatus, ProjectVisibility } from '@lobechat/types';
import { and, asc, desc, eq, inArray, isNull, max, or, sql } from 'drizzle-orm';

import { agents } from '../schemas/agent';
import { knowledgeBases } from '../schemas/file';
import { goals } from '../schemas/goal';
import {
  projectAgents,
  projectCompletionReviews,
  projectKnowledgeBases,
  projects,
  projectWorks,
} from '../schemas/project';
import { tasks } from '../schemas/task';
import { works } from '../schemas/work';
import type { LobeChatDatabase } from '../type';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';
import { AgentModel } from './agent';

export interface CreateProjectInput {
  avatar?: string;
  description?: string;
  identifier: string;
  name: string;
  slug?: string;
  visibility?: ProjectVisibility;
}

export interface UpdateProjectInput {
  avatar?: string | null;
  description?: string | null;
  name?: string;
  slug?: string | null;
  visibility?: ProjectVisibility;
}

export interface ProjectAgentInput {
  agentId: string;
  enabled?: boolean;
  responsibility?: string | null;
  role?: string | null;
  sortOrder?: number;
}

export interface ProjectKnowledgeBaseInput {
  enabled?: boolean;
  knowledgeBaseId: string;
  sortOrder?: number;
}

export interface ProjectWorkInput {
  sortOrder?: number;
  workId: string;
}

export class ProjectModel {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private readable() {
    return buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, projects);
  }

  private manageable() {
    return and(this.readable(), eq(projects.userId, this.userId));
  }

  async create(input: CreateProjectInput) {
    const identifier = input.identifier.trim().toUpperCase();
    if (identifier.length < 3 || identifier.length > 6) {
      throw new Error('Project identifier must be between 3 and 6 characters');
    }

    return this.db.transaction(async (tx) => {
      const coordinatorConfig = createProjectCoordinatorAgentConfig({
        avatar: input.avatar,
        description: input.description,
        identifier,
        name: input.name,
      });
      const coordinator = await new AgentModel(
        tx as LobeChatDatabase,
        this.userId,
        this.workspaceId,
      ).create({
        ...coordinatorConfig,
        visibility: input.visibility,
        virtual: true,
      });

      const [project] = await tx
        .insert(projects)
        .values(
          buildWorkspacePayload(
            { userId: this.userId, workspaceId: this.workspaceId },
            { ...input, coordinatorAgentId: coordinator.id, identifier },
          ),
        )
        .returning();

      await tx.insert(projectAgents).values({
        addedByUserId: this.userId,
        agentId: coordinator.id,
        projectId: project.id,
        responsibility: 'Coordinates project conversations, work, and resources',
        role: 'coordinator',
        workspaceId: this.workspaceId ?? null,
      });

      return project;
    });
  }

  async delete(id: string) {
    return this.db.transaction(async (tx) => {
      const [project] = await tx
        .select({ coordinatorAgentId: projects.coordinatorAgentId })
        .from(projects)
        .where(and(eq(projects.id, id), this.manageable()))
        .limit(1);
      if (!project) return null;

      const [deleted] = await tx
        .delete(projects)
        .where(and(eq(projects.id, id), this.manageable()))
        .returning();
      await new AgentModel(tx as LobeChatDatabase, this.userId, this.workspaceId).delete(
        project.coordinatorAgentId,
      );
      return deleted ?? null;
    });
  }

  async findById(id: string) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), this.readable()))
      .limit(1);
    return project ?? null;
  }

  async findByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(projects)
      .where(and(inArray(projects.id, ids), this.readable()));
  }

  async findByIdOrSlug(reference: string) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(and(or(eq(projects.id, reference), eq(projects.slug, reference)), this.readable()))
      .limit(1);
    return project ?? null;
  }

  async list(options: { limit?: number; offset?: number; statuses?: ProjectStatus[] } = {}) {
    const { limit = 50, offset = 0, statuses } = options;
    const statusWhere = statuses?.length ? inArray(projects.status, statuses) : undefined;
    return this.db
      .select()
      .from(projects)
      .where(and(this.readable(), statusWhere))
      .orderBy(desc(projects.updatedAt))
      .limit(limit)
      .offset(offset);
  }

  async update(id: string, input: UpdateProjectInput) {
    const [project] = await this.db
      .update(projects)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(projects.id, id), this.manageable()))
      .returning();
    return project ?? null;
  }

  async updateStatus(id: string, status: ProjectStatus) {
    if (status === 'completed' || status === 'reviewing') {
      throw new Error('Completion states must be changed through the review workflow');
    }
    const project = await this.findManageableById(id);
    if (!project) return null;
    if (project.status === 'reviewing') {
      throw new Error('A project awaiting review must be accepted or rejected');
    }
    if (project.status === 'completed' && status !== 'archived') {
      throw new Error('A completed project must be reopened before changing status');
    }
    if (project.completedReviewId && status !== 'archived') {
      throw new Error('An archived completed project must be reopened before changing status');
    }
    return this.setStatus(id, status, project.startedAt);
  }

  private async setStatus(id: string, status: ProjectStatus, startedAt?: Date | null) {
    const now = new Date();
    const timestamps = {
      ...(status === 'active' ? { startedAt: startedAt ?? now } : {}),
      ...(status === 'archived' ? { archivedAt: now } : {}),
      ...(status !== 'archived' ? { archivedAt: null } : {}),
      updatedAt: now,
    };
    const [project] = await this.db
      .update(projects)
      .set({ ...timestamps, status })
      .where(and(eq(projects.id, id), this.manageable()))
      .returning();
    return project ?? null;
  }

  async listAgents(projectId: string) {
    if (!(await this.findById(projectId))) return null;
    return this.db
      .select({ agent: agents, binding: projectAgents })
      .from(projectAgents)
      .innerJoin(agents, eq(projectAgents.agentId, agents.id))
      .where(
        and(
          eq(projectAgents.projectId, projectId),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agents),
        ),
      )
      .orderBy(asc(projectAgents.sortOrder), asc(projectAgents.createdAt));
  }

  async addAgent(projectId: string, input: ProjectAgentInput) {
    if (!(await this.findManageableById(projectId))) return null;
    const [agent] = await this.db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.id, input.agentId),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agents),
        ),
      )
      .limit(1);
    if (!agent) throw new Error('Agent not found');

    const [binding] = await this.db
      .insert(projectAgents)
      .values({
        ...input,
        addedByUserId: this.userId,
        projectId,
        workspaceId: this.workspaceId ?? null,
      })
      .onConflictDoUpdate({
        set: {
          enabled: input.enabled,
          responsibility: input.responsibility,
          role: input.role,
          sortOrder: input.sortOrder,
          updatedAt: new Date(),
        },
        target: [projectAgents.projectId, projectAgents.agentId],
      })
      .returning();
    return binding;
  }

  async removeAgent(projectId: string, agentId: string) {
    const project = await this.findManageableById(projectId);
    if (!project) return false;
    if (project.coordinatorAgentId === agentId) {
      throw new Error('The project coordinator cannot be removed');
    }
    const deleted = await this.db
      .delete(projectAgents)
      .where(and(eq(projectAgents.projectId, projectId), eq(projectAgents.agentId, agentId)))
      .returning({ id: projectAgents.id });
    return deleted.length > 0;
  }

  async listKnowledgeBases(projectId: string) {
    if (!(await this.findById(projectId))) return null;
    return this.db
      .select({ binding: projectKnowledgeBases, knowledgeBase: knowledgeBases })
      .from(projectKnowledgeBases)
      .innerJoin(knowledgeBases, eq(projectKnowledgeBases.knowledgeBaseId, knowledgeBases.id))
      .where(
        and(
          eq(projectKnowledgeBases.projectId, projectId),
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            knowledgeBases,
          ),
        ),
      )
      .orderBy(asc(projectKnowledgeBases.sortOrder), asc(projectKnowledgeBases.createdAt));
  }

  async addKnowledgeBase(projectId: string, input: ProjectKnowledgeBaseInput) {
    if (!(await this.findManageableById(projectId))) return null;
    const [knowledgeBase] = await this.db
      .select({ id: knowledgeBases.id })
      .from(knowledgeBases)
      .where(
        and(
          eq(knowledgeBases.id, input.knowledgeBaseId),
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            knowledgeBases,
          ),
        ),
      )
      .limit(1);
    if (!knowledgeBase) throw new Error('Knowledge base not found');

    const [binding] = await this.db
      .insert(projectKnowledgeBases)
      .values({
        ...input,
        addedByUserId: this.userId,
        projectId,
        workspaceId: this.workspaceId ?? null,
      })
      .onConflictDoUpdate({
        set: { enabled: input.enabled, sortOrder: input.sortOrder, updatedAt: new Date() },
        target: [projectKnowledgeBases.projectId, projectKnowledgeBases.knowledgeBaseId],
      })
      .returning();
    return binding;
  }

  async removeKnowledgeBase(projectId: string, knowledgeBaseId: string) {
    if (!(await this.findManageableById(projectId))) return false;
    const deleted = await this.db
      .delete(projectKnowledgeBases)
      .where(
        and(
          eq(projectKnowledgeBases.projectId, projectId),
          eq(projectKnowledgeBases.knowledgeBaseId, knowledgeBaseId),
        ),
      )
      .returning({ id: projectKnowledgeBases.id });
    return deleted.length > 0;
  }

  async listWorks(projectId: string) {
    if (!(await this.findById(projectId))) return null;
    return this.db
      .select({ binding: projectWorks, work: works })
      .from(projectWorks)
      .innerJoin(works, eq(projectWorks.workId, works.id))
      .where(
        and(
          eq(projectWorks.projectId, projectId),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, works),
        ),
      )
      .orderBy(asc(projectWorks.sortOrder), asc(projectWorks.createdAt));
  }

  async addWork(projectId: string, input: ProjectWorkInput) {
    if (!(await this.findManageableById(projectId))) return null;
    const [work] = await this.db
      .select({ id: works.id })
      .from(works)
      .where(
        and(
          eq(works.id, input.workId),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, works),
        ),
      )
      .limit(1);
    if (!work) throw new Error('Work not found');

    const [binding] = await this.db
      .insert(projectWorks)
      .values({
        ...input,
        addedByUserId: this.userId,
        projectId,
        workspaceId: this.workspaceId ?? null,
      })
      .onConflictDoUpdate({
        set: { sortOrder: input.sortOrder, updatedAt: new Date() },
        target: [projectWorks.projectId, projectWorks.workId],
      })
      .returning();
    return binding;
  }

  async removeWork(projectId: string, workId: string) {
    if (!(await this.findManageableById(projectId))) return false;
    const deleted = await this.db
      .delete(projectWorks)
      .where(and(eq(projectWorks.projectId, projectId), eq(projectWorks.workId, workId)))
      .returning({ id: projectWorks.id });
    return deleted.length > 0;
  }

  async listTasks(projectId: string) {
    if (!(await this.findById(projectId))) return null;
    const rows = await this.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, projectId),
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            {
              userId: tasks.createdByUserId,
              visibility: tasks.visibility,
              workspaceId: tasks.workspaceId,
            },
          ),
        ),
      )
      .orderBy(asc(tasks.sortOrder), asc(tasks.seq));

    // Attach the goal entity carried by each task so project surfaces can tell
    // goal roots apart from plain tasks without re-querying per row.
    const goalRows =
      rows.length === 0
        ? []
        : await this.db
            .select()
            .from(goals)
            .where(
              and(
                eq(goals.subjectType, 'task'),
                inArray(
                  goals.subjectId,
                  rows.map(({ id }) => id),
                ),
              ),
            );
    const goalByTaskId = new Map(goalRows.map((row) => [row.subjectId!, row]));
    return rows.map((row) => ({ ...row, goal: goalByTaskId.get(row.id) ?? null }));
  }

  async getEnabledKnowledgeBaseIdsForTask(taskId: string) {
    const [task] = await this.db
      .select({ projectId: tasks.projectId })
      .from(tasks)
      .where(
        and(
          eq(tasks.id, taskId),
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            {
              userId: tasks.createdByUserId,
              visibility: tasks.visibility,
              workspaceId: tasks.workspaceId,
            },
          ),
        ),
      )
      .limit(1);
    if (!task?.projectId || !(await this.findById(task.projectId))) return [];

    const rows = await this.db
      .select({ id: projectKnowledgeBases.knowledgeBaseId })
      .from(projectKnowledgeBases)
      .innerJoin(knowledgeBases, eq(projectKnowledgeBases.knowledgeBaseId, knowledgeBases.id))
      .where(
        and(
          eq(projectKnowledgeBases.projectId, task.projectId),
          eq(projectKnowledgeBases.enabled, true),
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            knowledgeBases,
          ),
        ),
      );
    return rows.map(({ id }) => id);
  }

  async moveTaskTree(projectId: string, taskId: string) {
    if (!(await this.findManageableById(projectId))) return null;
    const taskScope = buildWorkspaceWhere(
      { userId: this.userId, workspaceId: this.workspaceId },
      {
        userId: tasks.createdByUserId,
        visibility: tasks.visibility,
        workspaceId: tasks.workspaceId,
      },
    );
    const [root] = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), taskScope, eq(tasks.createdByUserId, this.userId)))
      .limit(1);
    if (!root) throw new Error('Task not found');
    if (root.parentTaskId) {
      const [parent] = await this.db
        .select({ projectId: tasks.projectId })
        .from(tasks)
        .where(and(eq(tasks.id, root.parentTaskId), taskScope))
        .limit(1);
      if (parent?.projectId !== projectId) {
        throw new Error('Cannot move a task away from its parent project');
      }
    }

    // Visibility must not hide private descendants here: moving the visible
    // parent while leaving an unseen child behind would split one tree across
    // projects. The creator check below still rejects any row not owned by the
    // caller before the update runs.
    const treeScope = this.workspaceId
      ? eq(tasks.workspaceId, this.workspaceId)
      : and(eq(tasks.createdByUserId, this.userId), isNull(tasks.workspaceId));
    const descendants = await this.db.execute<{ created_by_user_id: string }>(sql`
      WITH RECURSIVE task_tree AS (
        SELECT ${tasks.id}, ${tasks.createdByUserId}
        FROM ${tasks}
        WHERE ${tasks.id} = ${root.id} AND ${treeScope}
        UNION ALL
        SELECT ${tasks.id}, ${tasks.createdByUserId}
        FROM ${tasks}
        JOIN task_tree parent ON ${tasks.parentTaskId} = parent.id
        WHERE ${treeScope}
      )
      SELECT created_by_user_id FROM task_tree
    `);
    if (descendants.rows.some(({ created_by_user_id }) => created_by_user_id !== this.userId)) {
      throw new Error('Cannot move a task tree containing tasks created by another user');
    }

    const { rows } = await this.db.execute<{ id: string }>(sql`
      WITH RECURSIVE task_tree AS (
        SELECT ${tasks.id}
        FROM ${tasks}
        WHERE ${tasks.id} = ${root.id} AND ${taskScope}
          AND ${tasks.createdByUserId} = ${this.userId}
        UNION ALL
        SELECT ${tasks.id}
        FROM ${tasks}
        JOIN task_tree parent ON ${tasks.parentTaskId} = parent.id
        WHERE ${taskScope} AND ${tasks.createdByUserId} = ${this.userId}
      )
      UPDATE ${tasks}
      SET ${sql.identifier(tasks.projectId.name)} = ${projectId},
          ${sql.identifier(tasks.updatedAt.name)} = NOW()
      WHERE ${tasks.id} IN (SELECT id FROM task_tree)
      RETURNING ${tasks.id}
    `);
    return rows;
  }

  async requestCompletion(id: string) {
    const project = await this.findManageableById(id);
    if (!project) return null;
    if (!['active', 'paused'].includes(project.status)) {
      throw new Error('Only active or paused projects can request completion');
    }
    return this.setStatus(id, 'reviewing', project.startedAt);
  }

  async reviewCompletion(id: string, decision: 'accepted' | 'rejected', comment?: string) {
    return this.db.transaction(async (tx) => {
      const [project] = await tx
        .select()
        .from(projects)
        .where(and(eq(projects.id, id), this.manageable()))
        .for('update')
        .limit(1);
      if (!project) return null;
      if (project.status !== 'reviewing') throw new Error('Project is not awaiting review');

      const [{ value: lastRound }] = await tx
        .select({ value: max(projectCompletionReviews.round) })
        .from(projectCompletionReviews)
        .where(eq(projectCompletionReviews.projectId, id));
      const [review] = await tx
        .insert(projectCompletionReviews)
        .values({
          comment,
          decision,
          projectId: id,
          reviewerUserId: this.userId,
          round: (lastRound ?? 0) + 1,
          workspaceId: this.workspaceId ?? null,
        })
        .returning();
      const now = new Date();
      const [updated] = await tx
        .update(projects)
        .set(
          decision === 'accepted'
            ? {
                completedAt: now,
                completedReviewId: review.id,
                status: 'completed',
                updatedAt: now,
              }
            : { completedAt: null, completedReviewId: null, status: 'active', updatedAt: now },
        )
        .where(eq(projects.id, id))
        .returning();
      return { project: updated, review };
    });
  }

  async listCompletionReviews(projectId: string) {
    if (!(await this.findById(projectId))) return null;
    return this.db
      .select()
      .from(projectCompletionReviews)
      .where(eq(projectCompletionReviews.projectId, projectId))
      .orderBy(desc(projectCompletionReviews.round));
  }

  async reopen(id: string) {
    const [project] = await this.db
      .update(projects)
      .set({ completedAt: null, completedReviewId: null, status: 'active', updatedAt: new Date() })
      .where(
        and(
          eq(projects.id, id),
          inArray(projects.status, ['completed', 'archived']),
          sql`${projects.completedReviewId} IS NOT NULL`,
          this.manageable(),
        ),
      )
      .returning();
    return project ?? null;
  }

  async findManageableById(id: string) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), this.manageable()))
      .limit(1);
    return project ?? null;
  }
}
