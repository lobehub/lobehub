import { PROJECT_MEMBER_ROLES, type ProjectMemberRole } from '@lobechat/types';
import { normalizeSiteOrigin } from '@lobechat/utils/siteOrigin';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, isNull } from 'drizzle-orm';

import { ProjectMemberModel, ProjectSiteModel } from '@/database/models/projectReview';
import { acceptances, projectSites, users, verifyRuns, workspaceMembers } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import {
  findProjectReviewScope,
  type ProjectReviewScope,
  resolveProjectReviewRole,
} from '@/server/services/acceptanceReview/projectAccess';

const siteReviewTitle = (name: string) => `Site review · ${name}`;

/** The acceptance page opens the first exact origin; a wildcard has no address to open. */
const sitePreviewUrl = (origins: string[]) => origins.find((origin) => !origin.includes('://*.'));

export interface SiteInput {
  name: string;
  origins: string[];
}

export class ProjectReviewService {
  private sites: ProjectSiteModel;
  private members: ProjectMemberModel;

  constructor(
    private db: LobeChatDatabase,
    private userId: string,
  ) {
    this.sites = new ProjectSiteModel(db);
    this.members = new ProjectMemberModel(db);
  }

  async listSites(projectId: string) {
    await this.assertRole(projectId, PROJECT_MEMBER_ROLES);
    return this.sites.listByProject(projectId);
  }

  async createSite(projectId: string, input: SiteInput) {
    const project = await this.assertRole(projectId, ['member', 'admin']);
    const origins = this.normalizeOrigins(input.origins);
    const name = input.name.trim();
    const previewUrl = sitePreviewUrl(origins);

    return this.db.transaction(async (tx) => {
      const [site] = await tx
        .insert(projectSites)
        .values({
          createdByUserId: this.userId,
          name,
          origins,
          projectId,
          workspaceId: project.workspaceId,
        })
        .returning();
      const [acceptance] = await tx
        .insert(acceptances)
        .values({
          metadata: { title: siteReviewTitle(name) },
          projectId,
          status: 'delivered',
          subjectId: site.id,
          subjectType: 'site',
          userId: this.userId,
          visibility: 'private',
          workspaceId: project.workspaceId,
        })
        .returning();
      await tx.insert(verifyRuns).values({
        acceptanceId: acceptance.id,
        metadata: previewUrl ? { previewUrl } : {},
        roundIndex: 1,
        userId: this.userId,
        workspaceId: project.workspaceId,
      });
      const [linked] = await tx
        .update(projectSites)
        .set({ acceptanceId: acceptance.id })
        .where(eq(projectSites.id, site.id))
        .returning();
      return linked;
    });
  }

  async updateSite(siteId: string, input: Partial<SiteInput>) {
    const site = await this.findSite(siteId);
    await this.assertRole(site.projectId, ['member', 'admin']);
    const name = input.name?.trim();
    const origins = input.origins ? this.normalizeOrigins(input.origins) : undefined;

    return this.db.transaction(async (tx) => {
      const updated = await new ProjectSiteModel(tx).update(site.projectId, siteId, {
        name,
        origins,
      });
      if (!site.acceptanceId) return updated;

      if (name) {
        const [acceptance] = await tx
          .select({ metadata: acceptances.metadata })
          .from(acceptances)
          .where(eq(acceptances.id, site.acceptanceId));
        await tx
          .update(acceptances)
          .set({ metadata: { ...acceptance?.metadata, title: siteReviewTitle(name) } })
          .where(eq(acceptances.id, site.acceptanceId));
      }

      // Keep the standing review's preview on an origin the site still registers.
      if (origins) {
        const previewUrl = sitePreviewUrl(origins);
        const runs = await tx
          .select({ id: verifyRuns.id, metadata: verifyRuns.metadata })
          .from(verifyRuns)
          .where(eq(verifyRuns.acceptanceId, site.acceptanceId));
        for (const run of runs) {
          const { previewUrl: _previous, ...metadata } = run.metadata ?? {};
          await tx
            .update(verifyRuns)
            .set({ metadata: previewUrl ? { ...metadata, previewUrl } : metadata })
            .where(eq(verifyRuns.id, run.id));
        }
      }
      return updated;
    });
  }

  async deleteSite(siteId: string) {
    const site = await this.findSite(siteId);
    await this.assertRole(site.projectId, ['member', 'admin']);
    await this.db.transaction(async (tx) => {
      await tx
        .delete(projectSites)
        .where(and(eq(projectSites.projectId, site.projectId), eq(projectSites.id, siteId)));
      if (site.acceptanceId)
        await tx.delete(acceptances).where(eq(acceptances.id, site.acceptanceId));
    });
  }

  async listMembers(projectId: string) {
    const project = await this.assertRole(projectId, ['admin']);
    const rows = await this.members.listByProject(projectId);
    const people = project.workspaceId
      ? await this.db
          .select({
            avatar: users.avatar,
            email: users.email,
            fullName: users.fullName,
            userId: users.id,
            username: users.username,
          })
          .from(workspaceMembers)
          .innerJoin(users, eq(users.id, workspaceMembers.userId))
          .where(
            and(
              eq(workspaceMembers.workspaceId, project.workspaceId),
              isNull(workspaceMembers.deletedAt),
            ),
          )
          .orderBy(asc(users.fullName), asc(users.username), asc(users.id))
      : [];
    const profiles = people.map(({ fullName, username, ...person }) => ({
      ...person,
      name: fullName || username || person.email || person.userId,
    }));
    const peopleById = new Map(profiles.map((person) => [person.userId, person]));
    const overridden = new Set(rows.map((row) => row.userId));
    return {
      availableMembers: profiles.filter((person) => !overridden.has(person.userId)),
      members: rows.map((row) => ({ ...row, user: peopleById.get(row.userId) ?? null })),
      workspaceId: project.workspaceId,
    };
  }

  async setMemberRole(projectId: string, userId: string, role: ProjectMemberRole | null) {
    const project = await this.assertRole(projectId, ['admin']);
    if (!project.workspaceId)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Project members require a workspace' });
    const member =
      role === null
        ? await this.members.clearRole(project.workspaceId, projectId, userId)
        : await this.members.add({ projectId, userId, role, addedByUserId: this.userId });
    if (role !== null && !member)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Select an active member of this project workspace',
      });
    return member;
  }

  private normalizeOrigins(input: string[]) {
    if (input.length === 0)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'invalidOrigin:0:invalid' });
    const origins = input.map((value, index) => {
      const result = normalizeSiteOrigin(value);
      if (!result.ok) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `invalidOrigin:${index}:${result.reason}`,
        });
      }
      return result.origin;
    });
    return [...new Set(origins)];
  }

  private async assertRole(
    projectId: string,
    roles: readonly ProjectMemberRole[],
  ): Promise<ProjectReviewScope> {
    const project = await findProjectReviewScope(this.db, projectId);
    if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
    const role = await resolveProjectReviewRole(this.db, this.userId, project);
    if (!role || !roles.includes(role)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot manage review access' });
    }
    return project;
  }

  private async findSite(siteId: string) {
    const site = await this.sites.findById(siteId);
    if (!site) throw new TRPCError({ code: 'NOT_FOUND', message: 'Site not found' });
    return site;
  }
}
