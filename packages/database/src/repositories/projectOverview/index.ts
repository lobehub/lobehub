import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';

import { agents } from '../../schemas/agent';
import { projectAgents, projects } from '../../schemas/project';
import { tasks } from '../../schemas/task';
import type { LobeChatDatabase } from '../../type';
import { buildWorkspaceWhere } from '../../utils/workspace';

/** Tasks a folder card lists: the latest one as its headline, the rest as rows. */
export const PROJECT_OVERVIEW_TASK_LIMIT = 4;
/** Agents a folder card stacks. */
export const PROJECT_OVERVIEW_AGENT_LIMIT = 3;

export interface ProjectOverviewTask {
  id: string;
  identifier: string;
  name: string | null;
  status: string;
  /** Only the latest task carries one; the card shows it under the headline. */
  summary: string | null;
  updatedAt: Date;
}

export interface ProjectOverviewAgent {
  avatar: string | null;
  backgroundColor: string | null;
  id: string;
  name: string | null;
  title: string | null;
}

export interface ProjectOverview {
  agentCount: number;
  /** Members, the main agent first, at most {@link PROJECT_OVERVIEW_AGENT_LIMIT}. */
  agents: ProjectOverviewAgent[];
  projectId: string;
  /** Last updated first, at most {@link PROJECT_OVERVIEW_TASK_LIMIT}. */
  recentTasks: ProjectOverviewTask[];
  taskCount: number;
  taskDoneCount: number;
}

const emptyOverview = (projectId: string): ProjectOverview => ({
  agentCount: 0,
  agents: [],
  projectId,
  recentTasks: [],
  taskCount: 0,
  taskDoneCount: 0,
});

/**
 * What the projects page draws on each folder card, for every project the
 * caller can see, in one batch: a fixed number of queries whatever the number
 * of projects, so the grid never asks per card.
 */
export class ProjectOverviewRepository {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {}

  private get scope() {
    return { userId: this.userId, workspaceId: this.workspaceId };
  }

  private readableProjectIds() {
    return this.db
      .select({ id: projects.id })
      .from(projects)
      .where(buildWorkspaceWhere(this.scope, projects));
  }

  /** The same tasks the project page lists (`ProjectModel.listTasks`), without canceled ones. */
  private taskWhere() {
    return and(
      inArray(tasks.projectId, this.readableProjectIds()),
      ne(tasks.status, 'canceled'),
      buildWorkspaceWhere(this.scope, {
        isDeleted: tasks.isDeleted,
        userId: tasks.createdByUserId,
        visibility: tasks.visibility,
        workspaceId: tasks.workspaceId,
      }),
    );
  }

  async list(): Promise<ProjectOverview[]> {
    const [taskCounts, recentTasks, agentCounts, members] = await Promise.all([
      this.countTasks(),
      this.listRecentTasks(),
      this.countAgents(),
      this.listMembers(),
    ]);

    const overviews = new Map<string, ProjectOverview>();
    const overviewOf = (projectId: string) => {
      let overview = overviews.get(projectId);
      if (!overview) {
        overview = emptyOverview(projectId);
        overviews.set(projectId, overview);
      }
      return overview;
    };

    for (const row of taskCounts) {
      const overview = overviewOf(row.projectId);
      overview.taskCount = Number(row.total);
      overview.taskDoneCount = Number(row.done);
    }
    for (const { projectId, ...task } of recentTasks) overviewOf(projectId).recentTasks.push(task);
    for (const row of agentCounts) overviewOf(row.projectId).agentCount = Number(row.count);
    for (const { projectId, ...agent } of members) overviewOf(projectId).agents.push(agent);

    return [...overviews.values()];
  }

  private async countTasks() {
    return this.db
      .select({
        done: sql<number>`count(*) filter (where ${tasks.status} = 'completed')`,
        projectId: sql<string>`${tasks.projectId}`,
        total: sql<number>`count(*)`,
      })
      .from(tasks)
      .where(this.taskWhere())
      .groupBy(tasks.projectId);
  }

  private async listRecentTasks() {
    const ranked = this.db
      .select({
        description: tasks.description,
        id: tasks.id,
        identifier: tasks.identifier,
        name: tasks.name,
        projectId: sql<string>`${tasks.projectId}`.as('project_id'),
        rank: sql<number>`row_number() over (partition by ${tasks.projectId} order by ${tasks.updatedAt} desc, ${tasks.id} desc)`.as(
          'rank',
        ),
        status: tasks.status,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(this.taskWhere())
      .as('ranked_project_tasks');

    const rows = await this.db
      .select()
      .from(ranked)
      .where(sql`${ranked.rank} <= ${PROJECT_OVERVIEW_TASK_LIMIT}`)
      .orderBy(asc(ranked.projectId), asc(ranked.rank));

    return rows.map(({ description, rank, ...task }) => ({
      ...task,
      summary: Number(rank) === 1 ? description || null : null,
    }));
  }

  private memberWhere() {
    return and(
      inArray(projectAgents.projectId, this.readableProjectIds()),
      buildWorkspaceWhere(this.scope, agents),
    );
  }

  private async countAgents() {
    return this.db
      .select({ count: sql<number>`count(*)`, projectId: projectAgents.projectId })
      .from(projectAgents)
      .innerJoin(agents, eq(projectAgents.agentId, agents.id))
      .where(this.memberWhere())
      .groupBy(projectAgents.projectId);
  }

  /** Member order of `ProjectModel.listAgents`: the main agent, then the project order. */
  private async listMembers() {
    const ranked = this.db
      .select({
        avatar: agents.avatar,
        backgroundColor: agents.backgroundColor,
        id: agents.id,
        name: agents.name,
        projectId: sql<string>`${projectAgents.projectId}`.as('project_id'),
        rank: sql<number>`row_number() over (partition by ${projectAgents.projectId} order by case when ${projectAgents.agentId} = ${projects.coordinatorAgentId} then 0 else 1 end, ${projectAgents.sortOrder}, ${projectAgents.createdAt})`.as(
          'rank',
        ),
        title: agents.title,
      })
      .from(projectAgents)
      .innerJoin(agents, eq(projectAgents.agentId, agents.id))
      .innerJoin(projects, eq(projectAgents.projectId, projects.id))
      .where(this.memberWhere())
      .as('ranked_project_agents');

    const rows = await this.db
      .select()
      .from(ranked)
      .where(sql`${ranked.rank} <= ${PROJECT_OVERVIEW_AGENT_LIMIT}`)
      .orderBy(asc(ranked.projectId), asc(ranked.rank));

    return rows.map(({ rank: _rank, ...agent }) => agent);
  }
}
