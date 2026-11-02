import { and, asc, eq, isNull } from 'drizzle-orm';

import type { NewProjectMember, NewProjectSite, ProjectMemberItem } from '../schemas';
import { projectMembers, projects, projectSites, workspaceMembers } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { WorkspaceMemberModel } from './workspaceMember';

export type CreateProjectSiteInput = Pick<
  NewProjectSite,
  'acceptanceId' | 'createdByUserId' | 'name' | 'origins' | 'projectId' | 'workspaceId'
>;

export class ProjectSiteModel {
  constructor(private db: LobeChatDatabase) {}

  async create(input: CreateProjectSiteInput) {
    const [site] = await this.db.insert(projectSites).values(input).returning();
    return site;
  }

  async findById(id: string) {
    const [site] = await this.db
      .select()
      .from(projectSites)
      .where(eq(projectSites.id, id))
      .limit(1);
    return site ?? null;
  }

  listByProject(projectId: string) {
    return this.db
      .select()
      .from(projectSites)
      .where(eq(projectSites.projectId, projectId))
      .orderBy(asc(projectSites.createdAt));
  }

  async update(
    projectId: string,
    id: string,
    value: Partial<Pick<NewProjectSite, 'acceptanceId' | 'name' | 'origins'>>,
  ) {
    const [site] = await this.db
      .update(projectSites)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(projectSites.projectId, projectId), eq(projectSites.id, id)))
      .returning();
    return site ?? null;
  }

  async delete(projectId: string, id: string) {
    const [site] = await this.db
      .delete(projectSites)
      .where(and(eq(projectSites.projectId, projectId), eq(projectSites.id, id)))
      .returning();
    return site ?? null;
  }
}

export class ProjectMemberModel {
  constructor(private db: LobeChatDatabase) {}

  async add(input: Pick<NewProjectMember, 'addedByUserId' | 'projectId' | 'role' | 'userId'>) {
    return this.db.transaction(async (tx) => {
      const [project] = await tx
        .select({ workspaceId: projects.workspaceId })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);
      if (!project?.workspaceId) return null;
      const member = await new WorkspaceMemberModel(tx, input.userId).getMemberForUpdate(
        project.workspaceId,
        input.userId,
      );
      if (!member) return null;
      const [added] = await tx
        .insert(projectMembers)
        .values({ ...input, workspaceId: project.workspaceId })
        .onConflictDoUpdate({
          target: [projectMembers.projectId, projectMembers.userId],
          set: { role: input.role, updatedAt: new Date() },
        })
        .returning();
      return added;
    });
  }

  async listByProject(projectId: string) {
    const rows = await this.db
      .select({ member: projectMembers })
      .from(projectMembers)
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, projectMembers.workspaceId),
          eq(workspaceMembers.userId, projectMembers.userId),
        ),
      )
      .where(and(eq(projectMembers.projectId, projectId), isNull(workspaceMembers.deletedAt)))
      .orderBy(asc(projectMembers.createdAt));
    return rows.map(({ member }) => member);
  }

  async findById(id: string) {
    const [member] = await this.db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.id, id))
      .limit(1);
    return member ?? null;
  }

  async findActive(projectId: string, userId: string): Promise<ProjectMemberItem | null> {
    const [row] = await this.db
      .select({ member: projectMembers })
      .from(projectMembers)
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, projectMembers.workspaceId),
          eq(workspaceMembers.userId, projectMembers.userId),
        ),
      )
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .limit(1);
    return row?.member ?? null;
  }

  async clearRole(workspaceId: string, projectId: string, userId: string) {
    const [member] = await this.db
      .delete(projectMembers)
      .where(
        and(
          eq(projectMembers.workspaceId, workspaceId),
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
        ),
      )
      .returning();
    return member ?? null;
  }
}
