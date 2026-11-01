// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import {
  acceptances,
  users,
  verifyRuns,
  workspaceMembers,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectModel } from '@/database/models/project';
import {
  cleanupTestUser,
  createTestUser,
} from '@/server/routers/lambda/__tests__/integration/setup';

import { ProjectReviewService } from './index';

describe('ProjectReviewService', () => {
  let db: LobeChatDatabase;
  let ownerId: string;
  let adminId: string;
  let memberId: string;
  let guestId: string;
  let projectId: string;
  let workspaceId: string;

  const as = (userId: string) => new ProjectReviewService(db, userId);

  beforeEach(async () => {
    db = await getTestDB();
    ownerId = await createTestUser(db);
    adminId = await createTestUser(db);
    memberId = await createTestUser(db);
    guestId = await createTestUser(db);
    await db
      .update(users)
      .set({ email: 'alex@studio-north.co', fullName: 'Alex' })
      .where(eq(users.id, guestId));
    await db.update(users).set({ fullName: 'Innei' }).where(eq(users.id, ownerId));

    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Fieldnotes', primaryOwnerId: ownerId, slug: `ws-${ownerId}` })
      .returning();
    workspaceId = workspace.id;
    await db.insert(workspaceMembers).values([
      { role: 'owner', userId: ownerId, workspaceId },
      { role: 'admin', userId: adminId, workspaceId },
      { role: 'member', userId: memberId, workspaceId },
    ]);
    const project = await new ProjectModel(db, ownerId, workspaceId).create({
      identifier: 'SITE',
      name: 'Fieldnotes 官网',
    });
    projectId = project.id;
  });

  afterEach(async () => {
    for (const id of [guestId, memberId, adminId, ownerId]) await cleanupTestUser(db, id);
  });

  describe('sites', () => {
    it('creates a site with normalized origins and a private standing review for it', async () => {
      const site = await as(ownerId).createSite(projectId, {
        name: 'Marketing site',
        origins: ['HTTPS://Fieldnotes.app/', 'https://*.fieldnotes.app'],
      });

      expect(site.origins).toEqual(['https://fieldnotes.app', 'https://*.fieldnotes.app']);
      expect(site.workspaceId).toBe(workspaceId);

      const [acceptance] = await db
        .select()
        .from(acceptances)
        .where(eq(acceptances.id, site.acceptanceId!));
      expect(acceptance).toMatchObject({
        metadata: { title: 'Site review · Marketing site' },
        projectId,
        status: 'delivered',
        subjectId: site.id,
        subjectType: 'site',
        visibility: 'private',
        workspaceId,
      });
      const runs = await db
        .select()
        .from(verifyRuns)
        .where(eq(verifyRuns.acceptanceId, acceptance.id));
      expect(runs).toEqual([
        expect.objectContaining({
          metadata: { previewUrl: 'https://fieldnotes.app' },
          roundIndex: 1,
        }),
      ]);
    });

    it('leaves the preview unset when every origin is a wildcard', async () => {
      const site = await as(ownerId).createSite(projectId, {
        name: 'Previews',
        origins: ['https://*.fieldnotes.app'],
      });
      const runs = await db
        .select()
        .from(verifyRuns)
        .where(eq(verifyRuns.acceptanceId, site.acceptanceId!));
      expect(runs[0].metadata?.previewUrl).toBeUndefined();
    });

    it('rejects an invalid origin and says which one', async () => {
      await expect(
        as(ownerId).createSite(projectId, {
          name: 'Bad',
          origins: ['https://fieldnotes.app', 'https://*.vercel.app'],
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'invalidOrigin:1:sharedHostWildcard',
      });
    });

    it('moves the standing preview with the registered origins', async () => {
      const service = as(ownerId);
      const site = await service.createSite(projectId, {
        name: 'Marketing site',
        origins: ['https://fieldnotes.app'],
      });
      const preview = async () => {
        const [run] = await db
          .select()
          .from(verifyRuns)
          .where(eq(verifyRuns.acceptanceId, site.acceptanceId!));
        return run.metadata?.previewUrl;
      };

      await service.updateSite(site.id, { origins: ['https://www.fieldnotes.app'] });
      expect(await preview()).toBe('https://www.fieldnotes.app');

      await service.updateSite(site.id, { origins: ['https://*.fieldnotes.app'] });
      expect(await preview()).toBeUndefined();

      await service.updateSite(site.id, {
        origins: ['https://*.fieldnotes.app', 'https://fieldnotes.app'],
      });
      expect(await preview()).toBe('https://fieldnotes.app');

      await service.updateSite(site.id, { name: 'Landing pages' });
      expect(await preview()).toBe('https://fieldnotes.app');
    });

    it('renames the standing review with the site and deletes both together', async () => {
      const service = as(ownerId);
      const site = await service.createSite(projectId, {
        name: 'Marketing site',
        origins: ['https://fieldnotes.app'],
      });

      await service.updateSite(site.id, { name: 'Landing pages' });
      const [renamed] = await db
        .select()
        .from(acceptances)
        .where(eq(acceptances.id, site.acceptanceId!));
      expect(renamed.metadata).toMatchObject({ title: 'Site review · Landing pages' });

      await service.deleteSite(site.id);
      expect(await service.listSites(projectId)).toEqual([]);
      expect(
        await db.select().from(acceptances).where(eq(acceptances.id, site.acceptanceId!)),
      ).toEqual([]);
    });

    it('lets writable members edit sites and keeps viewers read-only', async () => {
      await expect(
        as(adminId).createSite(projectId, { name: 'A', origins: ['https://a.fieldnotes.app'] }),
      ).resolves.toBeTruthy();
      await expect(
        as(memberId).createSite(projectId, {
          name: 'Member site',
          origins: ['https://m.fieldnotes.app'],
        }),
      ).resolves.toBeTruthy();
      await db
        .update(workspaceMembers)
        .set({ role: 'viewer' })
        .where(eq(workspaceMembers.userId, memberId));
      await expect(as(memberId).listSites(projectId)).resolves.toHaveLength(2);
      await expect(
        as(memberId).createSite(projectId, { name: 'B', origins: ['https://b.fieldnotes.app'] }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('members', () => {
    it('stores only role overrides and clearing one restores inheritance', async () => {
      const service = as(ownerId);
      expect((await service.listMembers(projectId)).members).toEqual([]);
      const member = await service.setMemberRole(projectId, memberId, 'viewer');
      expect(member).toMatchObject({ userId: memberId, role: 'viewer' });
      const result = await service.listMembers(projectId);
      expect(result.workspaceId).toBe(workspaceId);
      expect(result.members).toEqual([
        expect.objectContaining({ userId: memberId, role: 'viewer' }),
      ]);
      expect(result.availableMembers.map((person) => person.userId)).not.toContain(memberId);
      await service.setMemberRole(projectId, memberId, 'admin');
      expect((await service.listMembers(projectId)).members[0].role).toBe('admin');
      await service.setMemberRole(projectId, memberId, null);
      expect((await service.listMembers(projectId)).members).toEqual([]);
    });

    it('rejects outsiders and soft-deleted workspace members', async () => {
      await expect(as(ownerId).setMemberRole(projectId, guestId, 'member')).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      await db
        .update(workspaceMembers)
        .set({ deletedAt: new Date() })
        .where(eq(workspaceMembers.userId, memberId));
      await expect(as(ownerId).setMemberRole(projectId, memberId, 'member')).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      expect(
        (await as(ownerId).listMembers(projectId)).availableMembers.map((person) => person.userId),
      ).not.toContain(memberId);
    });

    it('does not offer member management on a personal project', async () => {
      const personal = await new ProjectModel(db, ownerId).create({
        identifier: 'MEP',
        name: 'Personal',
      });
      expect(await as(ownerId).listMembers(personal.id)).toMatchObject({
        workspaceId: null,
        members: [],
        availableMembers: [],
      });
      await expect(
        as(ownerId).setMemberRole(personal.id, memberId, 'member'),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });

    it('requires the effective project admin role to manage members', async () => {
      await expect(as(memberId).listMembers(projectId)).rejects.toBeInstanceOf(TRPCError);
      await expect(as(guestId).setMemberRole(projectId, memberId, 'member')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await as(ownerId).setMemberRole(projectId, memberId, 'admin');
      await expect(as(memberId).listMembers(projectId)).resolves.toBeTruthy();
      await as(ownerId).setMemberRole(projectId, adminId, 'viewer');
      await expect(as(adminId).listMembers(projectId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('keeps a project override scoped to its project', async () => {
      const service = as(ownerId);
      await service.setMemberRole(projectId, memberId, 'admin');
      const other = await new ProjectModel(db, ownerId, workspaceId).create({
        identifier: 'OTH',
        name: 'Other',
      });
      await expect(as(memberId).setMemberRole(other.id, adminId, 'viewer')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(as(memberId).setMemberRole(other.id, adminId, null)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });
});
