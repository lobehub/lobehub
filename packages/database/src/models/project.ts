import { BUILTIN_AGENT_SLUGS, createProjectCoordinatorAgentConfig } from '@lobechat/builtin-agents';
import { INBOX_SESSION_ID } from '@lobechat/const';
import type { ProjectStatus, ProjectVisibility } from '@lobechat/types';
import { and, asc, desc, eq, inArray, isNull, max, ne, or, sql } from 'drizzle-orm';

import { agents } from '../schemas/agent';
import { chatGroupsAgents } from '../schemas/chatGroup';
import { environments } from '../schemas/environment';
import { knowledgeBases } from '../schemas/file';
import {
  projectAgents,
  projectCompletionReviews,
  projectKnowledgeBases,
  projects,
} from '../schemas/project';
import { projectEnvironments } from '../schemas/projectEnvironment';
import { projectWorks } from '../schemas/projectWork';
import { agentsToSessions } from '../schemas/relations';
import { tasks } from '../schemas/task';
import { topics } from '../schemas/topic';
import { works } from '../schemas/work';
import type { LobeChatDatabase } from '../type';
import { joinTopicAgentsToProjects } from '../utils/projectTopicAgents';
import { topicRunStartedAtColumn } from '../utils/topicRunStartedAt';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';
import { AgentModel } from './agent';
import { EnvironmentModel } from './environment';
import { topicHasGoal } from './topicGoal';

export interface CreateProjectInput {
  avatar?: string;
  /** Lead the project with an existing agent instead of provisioning a dedicated one. */
  coordinatorAgentId?: string;
  description?: string;
  /** Task prefix for this project; omit to keep the scope's default prefix. */
  identifier?: string | null;
  name: string;
  slug?: string;
  visibility?: ProjectVisibility;
}

const BUILTIN_SLUGS: ReadonlySet<string> = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

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

export type ProjectAgentPatch = Partial<Omit<ProjectAgentInput, 'agentId'>>;

export interface ProjectKnowledgeBaseInput {
  enabled?: boolean;
  knowledgeBaseId: string;
  sortOrder?: number;
}

export type ProjectKnowledgeBasePatch = Partial<Omit<ProjectKnowledgeBaseInput, 'knowledgeBaseId'>>;

/** Display meta of a project's main agent, joined into list rows only. */
export interface ProjectCoordinatorAgentMeta {
  avatar: string | null;
  backgroundColor: string | null;
  id: string;
  name: string | null;
  title: string | null;
}

export type ProjectListRow = typeof projects.$inferSelect & {
  coordinatorAgent: ProjectCoordinatorAgentMeta | null;
};

export interface ProjectModelOptions {
  /**
   * Workspace owners and admins manage the agent members of every readable
   * project, not only the projects they created.
   */
  canManageAllMembers?: boolean;
  /**
   * The caller only reads the workspace (a viewer): the write gate rejects
   * every project mutation, whatever the caller created or curates.
   */
  readOnly?: boolean;
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
    private readonly options: ProjectModelOptions = {},
  ) {}

  private readable() {
    return buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, projects);
  }

  /**
   * Any member who can edit (the router's `agent:update` gate keeps viewers out)
   * may manage a project they can see, whoever created it. Private projects stay
   * creator-only because `readable()` hides them from everyone else.
   */
  private manageable() {
    return this.readable();
  }

  /** Visibility decides who sees the project at all, so only its creator may change it. */
  private ownedByCaller() {
    return and(this.readable(), eq(projects.userId, this.userId));
  }

  /**
   * A public workspace project is seen by every member, while a private agent
   * or library is visible to its creator alone, so such a project binds only
   * public resources. Anything else would show each reader a different project.
   */
  private assertSharedResource(
    project: { visibility: string; workspaceId: string | null },
    resourceVisibility: string,
    message: string,
  ) {
    if (project.workspaceId && project.visibility === 'public' && resourceVisibility !== 'public')
      throw new Error(message);
  }

  /** Member management: the creator, or a workspace admin for any readable project. */
  private membersManageable() {
    return this.options.canManageAllMembers && this.workspaceId
      ? this.readable()
      : this.ownedByCaller();
  }

  async create(input: CreateProjectInput) {
    const identifier = input.identifier?.trim().toUpperCase() || null;
    if (identifier && (identifier.length < 3 || identifier.length > 6)) {
      throw new Error('Project identifier must be between 3 and 6 characters');
    }

    return this.db.transaction(async (tx) => {
      const coordinator = input.coordinatorAgentId
        ? await this.findAccessibleAgent(tx as LobeChatDatabase, input.coordinatorAgentId)
        : await new AgentModel(tx as LobeChatDatabase, this.userId, this.workspaceId).create({
            ...createProjectCoordinatorAgentConfig({
              avatar: input.avatar,
              description: input.description,
              identifier,
              name: input.name,
            }),
            visibility: input.visibility,
            virtual: true,
          });
      if (!coordinator) throw new Error('Agent not found');
      if (input.coordinatorAgentId) {
        this.assertSharedResource(
          { visibility: input.visibility ?? 'private', workspaceId: this.workspaceId ?? null },
          (coordinator as { visibility: string }).visibility,
          'A shared project only takes shared agents',
        );
      }

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
      if (project.coordinatorAgentId) {
        await this.deleteDedicatedCoordinator(tx as LobeChatDatabase, project.coordinatorAgentId);
      }
      return deleted ?? null;
    });
  }

  /**
   * Remove a coordinator only when it was provisioned for this project: a
   * virtual, non-builtin agent no other project still uses. Reusable agents
   * (user agents, LobeAI) stay with their sessions intact.
   */
  private async deleteDedicatedCoordinator(db: LobeChatDatabase, agentId: string) {
    if (!(await this.isDedicatedCoordinator(agentId, { db }))) return;
    await new AgentModel(db, this.userId, this.workspaceId).delete(agentId);
  }

  /**
   * A coordinator provisioned for one project: a virtual, non-builtin agent no
   * other project leads or counts as a member, and no group or session holds.
   */
  async isDedicatedCoordinator(
    agentId: string,
    {
      db = this.db,
      exceptProjectId,
    }: {
      db?: LobeChatDatabase;
      /** Ask before handing this project over: its own lead and membership do not count as "still used". */
      exceptProjectId?: string;
    } = {},
  ) {
    const [agent] = await db
      .select({ slug: agents.slug, virtual: agents.virtual })
      .from(agents)
      .where(
        and(
          eq(agents.id, agentId),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agents),
        ),
      )
      .limit(1);
    if (!agent?.virtual || (agent.slug && BUILTIN_SLUGS.has(agent.slug))) return false;

    const [stillUsed] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.coordinatorAgentId, agentId),
          exceptProjectId ? ne(projects.id, exceptProjectId) : undefined,
        ),
      )
      .limit(1);
    if (stillUsed) return false;

    // A group's own members are virtual and slugless as well; they belong to the group.
    // A session link would take the agent's conversations with it on delete, and a
    // member of another project would drop out of it.
    const [linked] = await db
      .select({ agentId: chatGroupsAgents.agentId })
      .from(chatGroupsAgents)
      .where(eq(chatGroupsAgents.agentId, agentId))
      .union(
        db
          .select({ agentId: agentsToSessions.agentId })
          .from(agentsToSessions)
          .where(eq(agentsToSessions.agentId, agentId)),
      )
      .union(
        db
          .select({ agentId: projectAgents.agentId })
          .from(projectAgents)
          .where(
            and(
              eq(projectAgents.agentId, agentId),
              exceptProjectId ? ne(projectAgents.projectId, exceptProjectId) : undefined,
            ),
          ),
      )
      .limit(1);
    return !linked;
  }

  /**
   * Fill each project's main agent. The column is cleared when that agent is
   * deleted (`ON DELETE SET NULL`); such projects fall back to LobeAI.
   */
  async resolveCoordinatorAgents<T extends { coordinatorAgentId: string | null }>(
    items: T[],
  ): Promise<(T & { coordinatorAgentId: string })[]> {
    if (items.every((item) => item.coordinatorAgentId)) {
      return items as (T & { coordinatorAgentId: string })[];
    }
    const inbox = await new AgentModel(this.db, this.userId, this.workspaceId).getBuiltinAgent(
      INBOX_SESSION_ID,
    );
    if (!inbox) throw new Error('Project main agent not found');
    return items.map((item) => ({
      ...item,
      coordinatorAgentId: item.coordinatorAgentId ?? inbox.id,
    }));
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

  /**
   * Resolve what a person or a repository config would write to name a
   * project: its id, its slug, or its task identifier (`LOBE`, matched
   * case-insensitively). An exact id beats a slug, and a slug beats an
   * identifier, so one project's identifier never shadows another's slug.
   */
  async findByReference(reference: string) {
    const identifier = reference.trim().toUpperCase();
    const [project] = await this.db
      .select()
      .from(projects)
      .where(
        and(
          or(
            eq(projects.id, reference),
            eq(projects.slug, reference),
            eq(projects.identifier, identifier),
          ),
          this.readable(),
        ),
      )
      .orderBy(
        sql`CASE WHEN ${projects.id} = ${reference} THEN 0 WHEN ${projects.slug} = ${reference} THEN 1 ELSE 2 END`,
      )
      .limit(1);
    return project ?? null;
  }

  async list(
    options: { limit?: number; offset?: number; statuses?: ProjectStatus[] } = {},
  ): Promise<ProjectListRow[]> {
    const { limit = 50, offset = 0, statuses } = options;
    const statusWhere = statuses?.length ? inArray(projects.status, statuses) : undefined;
    const rows = await this.db
      .select({
        // Drizzle nulls a left-joined object when its first column is null, so the
        // non-null id leads; coordinators usually have no avatar.
        coordinatorAgent: {
          id: agents.id,
          avatar: agents.avatar,
          backgroundColor: agents.backgroundColor,
          name: agents.name,
          title: agents.title,
        },
        project: projects,
      })
      .from(projects)
      .leftJoin(agents, eq(agents.id, projects.coordinatorAgentId))
      .where(and(this.readable(), statusWhere))
      // Recently updated first for every caller; the sidebar applies the manual
      // `sort_order` itself, so the order stays a sidebar view, not the API default.
      .orderBy(desc(projects.updatedAt))
      .limit(limit)
      .offset(offset);
    // Coordinators are virtual agents the client agent list never loads, so the
    // list carries their display meta for the owner column.
    return rows.map(({ coordinatorAgent, project }) => ({ ...project, coordinatorAgent }));
  }

  /**
   * Move one project in the scope's shared manual order, placing it directly
   * before or after `anchorId` (both must be visible to the caller).
   *
   * The order spans every project in the scope — including other members'
   * private ones the caller cannot see — so the move is applied to that full
   * list and every row is renumbered. Positions never collide across members,
   * no caller needs to send the whole list, and a per-scope lock makes sure
   * concurrent moves in one scope apply one after another. `updated_at` is left alone:
   * moving a project is not an edit, and the "recently updated" order must not
   * jump.
   */
  async move(id: string, anchor: { afterId: string } | { beforeId: string }) {
    const anchorId = 'beforeId' in anchor ? anchor.beforeId : anchor.afterId;
    if (anchorId === id) return;

    await this.db.transaction(async (tx) => {
      // Serialize moves per scope before reading the order. Locking the rows in
      // the ordered read itself is not enough: under READ COMMITTED a waiting
      // transaction would return the order it sorted before the wait.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`project-order:${this.workspaceId ?? `user:${this.userId}`}`}))`,
      );

      const visible = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(inArray(projects.id, [id, anchorId]), this.manageable()));
      if (visible.length !== 2) throw new Error('Project not found');

      const scope = buildWorkspaceWhere(
        { userId: this.userId, workspaceId: this.workspaceId },
        {
          isDeleted: projects.isDeleted,
          userId: projects.userId,
          workspaceId: projects.workspaceId,
        },
      );
      const rows = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(scope)
        .orderBy(sql`${projects.sortOrder} ASC NULLS FIRST`, desc(projects.updatedAt));

      // Either project may have been deleted since the check above.
      const ids = rows.map((row) => row.id);
      if (!ids.includes(id) || !ids.includes(anchorId)) throw new Error('Project not found');

      const order = ids.filter((rowId) => rowId !== id);
      const anchorIndex = order.indexOf(anchorId);
      order.splice('beforeId' in anchor ? anchorIndex : anchorIndex + 1, 0, id);

      const position = sql.join(
        order.map((rowId, index) => sql`WHEN ${rowId} THEN ${index}`),
        sql` `,
      );
      await tx
        .update(projects)
        .set({
          sortOrder: sql`(CASE ${projects.id} ${position} END)::integer`,
          updatedAt: sql`${projects.updatedAt}`,
        })
        .where(and(inArray(projects.id, order), scope));
    });
  }

  async update(id: string, input: UpdateProjectInput) {
    const [project] = await this.db
      .update(projects)
      .set({ ...input, updatedAt: new Date() })
      .where(
        and(
          eq(projects.id, id),
          input.visibility === undefined ? this.manageable() : this.ownedByCaller(),
        ),
      )
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

  /** Members in project order, the main agent always first. */
  async listAgents(projectId: string) {
    const project = await this.findById(projectId);
    if (!project) return null;
    // A cleared main agent (LobeAI fallback) has no member row to lead with. A
    // bare constant would not do instead: Postgres reads `ORDER BY 0` as a column position.
    const coordinatorFirst = project.coordinatorAgentId
      ? [sql`CASE WHEN ${projectAgents.agentId} = ${project.coordinatorAgentId} THEN 0 ELSE 1 END`]
      : [];
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
      .orderBy(...coordinatorFirst, asc(projectAgents.sortOrder), asc(projectAgents.createdAt));
  }

  /**
   * TODO(2026-12-31): remove this runtime backfill. Topics filed before their
   * agents joined the project on write still leave those agents out of the
   * members; opening the member list brings them in. Read-only viewers only
   * look, so their visit changes nothing.
   */
  async joinTopicAgents(projectId: string) {
    if (this.options.readOnly || !(await this.findById(projectId))) return;
    await joinTopicAgentsToProjects(this.db, { projectId });
  }

  private async findAccessibleAgent(db: LobeChatDatabase, agentId: string) {
    const [agent] = await db
      .select({ id: agents.id, visibility: agents.visibility })
      .from(agents)
      .where(
        and(
          eq(agents.id, agentId),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agents),
        ),
      )
      .limit(1);
    return agent ?? null;
  }

  async addAgent(projectId: string, input: ProjectAgentInput) {
    const project = await this.findMembersManageableById(projectId);
    if (!project) return null;
    if (project.coordinatorAgentId === input.agentId) {
      throw new Error('The project coordinator is managed by the project');
    }
    const agent = await this.findAccessibleAgent(this.db, input.agentId);
    if (!agent) throw new Error('Agent not found');
    this.assertSharedResource(
      project,
      agent.visibility,
      'A shared project only takes shared agents',
    );

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

  async updateAgent(projectId: string, agentId: string, patch: ProjectAgentPatch) {
    const project = await this.findMembersManageableById(projectId);
    if (!project) return null;
    if (project.coordinatorAgentId === agentId) {
      throw new Error('The project coordinator is managed by the project');
    }
    const [binding] = await this.db
      .update(projectAgents)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(projectAgents.projectId, projectId), eq(projectAgents.agentId, agentId)))
      .returning();
    return binding ?? null;
  }

  async removeAgent(projectId: string, agentId: string) {
    const project = await this.findMembersManageableById(projectId);
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

  /**
   * Point the project at another main agent and seat it as an enabled member.
   * Returns the predecessor so the caller can retire or keep it; handing over a
   * coordinator's history spans other aggregates and lives in
   * `ProjectCoordinatorRepository`. Call it inside that transaction.
   */
  async assignCoordinator(projectId: string, agentId: string) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), this.membersManageable()))
      .limit(1)
      .for('update');
    if (!project) return null;
    if (project.coordinatorAgentId === agentId) return { previousId: null, project };

    const [agent] = await this.db
      .select({ id: agents.id, visibility: agents.visibility })
      .from(agents)
      .where(
        and(
          eq(agents.id, agentId),
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, agents),
        ),
      )
      .limit(1);
    if (!agent) throw new Error('Agent not found');
    this.assertSharedResource(
      project,
      agent.visibility,
      'A shared project only takes shared agents',
    );

    const [updated] = await this.db
      .update(projects)
      .set({ coordinatorAgentId: agentId, updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .returning();
    await this.db
      .insert(projectAgents)
      .values({
        addedByUserId: this.userId,
        agentId,
        projectId,
        workspaceId: this.workspaceId ?? null,
      })
      .onConflictDoUpdate({
        set: { enabled: true, updatedAt: new Date() },
        target: [projectAgents.projectId, projectAgents.agentId],
      });

    const previousId = project.coordinatorAgentId;
    if (previousId) {
      // The project role belonged to the main agent; as a member it reads like any other.
      await this.db
        .update(projectAgents)
        .set({ role: null, updatedAt: new Date() })
        .where(
          and(
            eq(projectAgents.projectId, projectId),
            eq(projectAgents.agentId, previousId),
            eq(projectAgents.role, 'coordinator'),
          ),
        );
    }
    return { previousId, project: updated };
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
    // Knowledge is curated by everyone who can read the project, not only its creator.
    const project = await this.findById(projectId);
    if (!project) return null;
    const [knowledgeBase] = await this.db
      .select({ id: knowledgeBases.id, visibility: knowledgeBases.visibility })
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
    this.assertSharedResource(
      project,
      knowledgeBase.visibility,
      'A shared project only takes shared knowledge bases',
    );

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

  async updateKnowledgeBase(
    projectId: string,
    knowledgeBaseId: string,
    patch: ProjectKnowledgeBasePatch,
  ) {
    if (!(await this.findById(projectId))) return null;
    const [binding] = await this.db
      .update(projectKnowledgeBases)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(projectKnowledgeBases.projectId, projectId),
          eq(projectKnowledgeBases.knowledgeBaseId, knowledgeBaseId),
        ),
      )
      .returning();
    return binding ?? null;
  }

  async removeKnowledgeBase(projectId: string, knowledgeBaseId: string) {
    if (!(await this.findById(projectId))) return false;
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
              isDeleted: tasks.isDeleted,
              userId: tasks.createdByUserId,
              visibility: tasks.visibility,
              workspaceId: tasks.workspaceId,
            },
          ),
        ),
      )
      .orderBy(asc(tasks.sortOrder), asc(tasks.seq));

    return rows;
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
              isDeleted: tasks.isDeleted,
              userId: tasks.createdByUserId,
              visibility: tasks.visibility,
              workspaceId: tasks.workspaceId,
            },
          ),
        ),
      )
      .limit(1);
    if (!task?.projectId) return [];
    return this.getEnabledKnowledgeBaseIds(task.projectId);
  }

  /** Enabled project knowledge bases the caller can still reach. */
  async getEnabledKnowledgeBaseIds(projectId: string) {
    if (!(await this.findById(projectId))) return [];

    const rows = await this.db
      .select({ id: projectKnowledgeBases.knowledgeBaseId })
      .from(projectKnowledgeBases)
      .innerJoin(knowledgeBases, eq(projectKnowledgeBases.knowledgeBaseId, knowledgeBases.id))
      .where(
        and(
          eq(projectKnowledgeBases.projectId, projectId),
          eq(projectKnowledgeBases.enabled, true),
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            knowledgeBases,
          ),
        ),
      );
    return rows.map(({ id }) => id);
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

  async findMembersManageableById(id: string) {
    const [project] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), this.membersManageable()))
      .limit(1);
    return project ?? null;
  }

  /** What the caller may change on a readable project; drives both the API and the UI. */
  getPermissions(project: { userId: string; workspaceId: string | null }) {
    if (this.options.readOnly) {
      return { canManage: false, canManageKnowledgeBases: false, canManageMembers: false };
    }
    const isCreator = project.userId === this.userId;
    return {
      canManage: true,
      canManageKnowledgeBases: true,
      canManageMembers: isCreator || (!!this.options.canManageAllMembers && !!project.workspaceId),
    };
  }

  /** Link an existing environment to a project; re-attaching is a no-op. */
  async attachEnvironment(projectId: string, environmentId: string) {
    if (!(await this.findManageableById(projectId)))
      throw new Error('Project not found or access denied');
    const environment = await new EnvironmentModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).findEnabledById(environmentId);
    if (!environment) throw new Error('Environment not found or access denied');
    await this.db
      .insert(projectEnvironments)
      .values({
        projectId,
        environmentId,
        workspaceId: this.workspaceId,
        addedByUserId: this.userId,
      })
      .onConflictDoNothing();
    return { projectId, environmentId };
  }

  /** Enabled environments linked to this project. */
  async listEnvironments(projectId: string) {
    if (!(await this.findById(projectId))) throw new Error('Project not found or access denied');
    return this.db
      .select({
        id: environments.id,
        name: environments.name,
        configuration: environments.configuration,
      })
      .from(environments)
      .innerJoin(
        projectEnvironments,
        and(
          eq(projectEnvironments.environmentId, environments.id),
          eq(projectEnvironments.projectId, projectId),
          eq(projectEnvironments.enabled, true),
        ),
      )
      .where(
        and(
          buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, environments),
          eq(environments.enabled, true),
        ),
      );
  }

  /** All conversations belonging to the project, with or without a working directory. */
  async listTopics(projectId: string) {
    if (!(await this.findById(projectId))) throw new Error('Project not found or access denied');
    const scope = { userId: this.userId, workspaceId: this.workspaceId };
    return this.db
      .select({
        id: topics.id,
        createdAt: topics.createdAt,
        favorite: topics.favorite,
        hasGoal: topicHasGoal(this.db, scope),
        metadata: topics.metadata,
        trigger: topics.trigger,
        userId: topics.userId,
        title: topics.title,
        status: topics.status,
        // The project sidebar draws a running row's elapsed clock from this.
        runStartedAt: topicRunStartedAtColumn(this.db),
        agentId: topics.agentId,
        agentTitle: agents.title,
        agentName: agents.name,
        agentAvatar: agents.avatar,
        // The agent's execution-target pin, so a sidebar group can tell where
        // the agent may start without loading every agent's full config.
        agentExecutionTargetSelectionPolicy: sql<
          string | null
        >`${agents.agencyConfig}->>'executionTargetSelectionPolicy'`,
        agentBoundDeviceId: sql<string | null>`${agents.agencyConfig}->>'boundDeviceId'`,
        // Lets a row act on its agent's external runtime (Claude Code / Codex)
        // when that agent's config has never been loaded into the client store.
        agentHeterogeneousProviderType: sql<
          string | null
        >`${agents.agencyConfig}->'heterogeneousProvider'->>'type'`,
        updatedAt: topics.updatedAt,
        projectWorkingDirectoryId: topics.projectWorkingDirectoryId,
      })
      .from(topics)
      .leftJoin(agents, and(eq(agents.id, topics.agentId), buildWorkspaceWhere(scope, agents)))
      .where(
        and(
          eq(topics.projectId, projectId),
          buildWorkspaceWhere(scope, topics),
          isNull(topics.deletedAt),
        ),
      )
      .orderBy(desc(topics.updatedAt));
  }
}
