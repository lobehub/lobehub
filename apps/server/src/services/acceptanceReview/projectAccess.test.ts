// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import { acceptances, projects, workspaceMembers, workspaces } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectModel } from '@/database/models/project';
import { ProjectMemberModel } from '@/database/models/projectReview';
import {
  cleanupTestUser,
  createTestUser,
} from '@/server/routers/lambda/__tests__/integration/setup';
import { resolveAcceptanceCommentAccess } from '@/server/routers/lambda/_helpers/acceptanceCommentAccess';
import { canReadAcceptance } from '@/server/routers/lambda/_helpers/acceptanceReadScope';

import { resolveReviewAccess } from './access';
import { resolveProjectReviewRole } from './projectAccess';

describe('site review access', () => {
  let db: LobeChatDatabase;
  let ownerId: string;
  let teammateId: string;
  let viewerId: string;
  let guestId: string;
  let strangerId: string;
  let projectId: string;
  let workspaceId: string;
  let siteAcceptanceId: string;

  const add = (userId: string, role: 'viewer' | 'member' | 'admin') =>
    new ProjectMemberModel(db).add({ projectId, userId, role });

  const notFound = (userId: string) =>
    expect(resolveAcceptanceCommentAccess(db, userId, siteAcceptanceId)).rejects.toThrow(TRPCError);

  beforeEach(async () => {
    db = await getTestDB();
    ownerId = await createTestUser(db);
    teammateId = await createTestUser(db);
    viewerId = await createTestUser(db);
    guestId = await createTestUser(db);
    strangerId = await createTestUser(db);

    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Fieldnotes', primaryOwnerId: ownerId, slug: `ws-${ownerId}` })
      .returning();
    workspaceId = workspace.id;
    await db.insert(workspaceMembers).values([
      { role: 'owner', userId: ownerId, workspaceId },
      { role: 'member', userId: teammateId, workspaceId },
      { role: 'viewer', userId: viewerId, workspaceId },
    ]);

    const project = await new ProjectModel(db, ownerId, workspaceId).create({
      identifier: 'SITE',
      name: 'Fieldnotes site',
    });
    projectId = project.id;

    const [acceptance] = await db
      .insert(acceptances)
      .values({
        projectId,
        subjectId: randomUUID(),
        subjectType: 'site',
        userId: teammateId,
        visibility: 'private',
        workspaceId,
      })
      .returning();
    siteAcceptanceId = acceptance.id;
  });

  afterEach(async () => {
    for (const id of [guestId, strangerId, viewerId, teammateId, ownerId]) {
      await cleanupTestUser(db, id);
    }
  });

  it('gives the project creator full rights even when someone else created the site review', async () => {
    const access = await resolveAcceptanceCommentAccess(db, ownerId, siteAcceptanceId);
    expect(access).toMatchObject({ canApprove: true, canComment: true });
  });

  it('lets a project member comment but not moderate', async () => {
    await add(teammateId, 'member');
    expect(await resolveAcceptanceCommentAccess(db, teammateId, siteAcceptanceId)).toMatchObject({
      canApprove: false,
      canComment: true,
      memberOfWorkspaceId: workspaceId,
    });
  });

  it('lets a project admin moderate', async () => {
    await add(teammateId, 'admin');
    expect(await resolveAcceptanceCommentAccess(db, teammateId, siteAcceptanceId)).toMatchObject({
      canApprove: true,
      canComment: true,
    });
  });

  it('inherits writable workspace roles without a project override', async () => {
    expect(await resolveAcceptanceCommentAccess(db, teammateId, siteAcceptanceId)).toMatchObject({
      canComment: true,
      canApprove: false,
    });
    expect(await resolveAcceptanceCommentAccess(db, viewerId, siteAcceptanceId)).toMatchObject({
      canComment: false,
      canApprove: false,
    });
  });

  it('lets a project read-only override take precedence and clearing it restores workspace access', async () => {
    await add(teammateId, 'viewer');
    expect(await resolveAcceptanceCommentAccess(db, teammateId, siteAcceptanceId)).toMatchObject({
      canComment: false,
      canApprove: false,
    });
    await new ProjectMemberModel(db).clearRole(workspaceId, projectId, teammateId);
    expect(await resolveAcceptanceCommentAccess(db, teammateId, siteAcceptanceId)).toMatchObject({
      canComment: true,
      canApprove: false,
    });
  });

  it('can give a workspace viewer write access in this project', async () => {
    await add(viewerId, 'member');
    expect(await resolveAcceptanceCommentAccess(db, viewerId, siteAcceptanceId)).toMatchObject({
      canComment: true,
      canApprove: false,
    });
  });

  it('rejects departed workspace members, including the project creator', async () => {
    await add(teammateId, 'admin');
    for (const userId of [teammateId, ownerId]) {
      await db
        .update(workspaceMembers)
        .set({ deletedAt: new Date() })
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
        );
      await notFound(userId);
    }
  });

  it('never opens a site review to strangers, even when it is marked public', async () => {
    await db
      .update(acceptances)
      .set({ visibility: 'public' })
      .where(eq(acceptances.id, siteAcceptanceId));
    await notFound(strangerId);
  });

  it('hides the site review from strangers', async () => {
    await notFound(strangerId);
  });

  it('never offers Accept or Send back on a site review', async () => {
    const access = await resolveReviewAccess(db, ownerId, siteAcceptanceId);
    expect(access?.can).toEqual({ comment: true, decide: false, moderate: true, reject: false });
  });

  it('names the role each person holds on the project', async () => {
    const project = (await db.select().from(projects).where(eq(projects.id, projectId)))[0];
    await add(teammateId, 'admin');

    expect(await resolveProjectReviewRole(db, ownerId, project)).toBe('admin');
    expect(await resolveProjectReviewRole(db, teammateId, project)).toBe('admin');
    expect(await resolveProjectReviewRole(db, viewerId, project)).toBe('viewer');
    expect(await resolveProjectReviewRole(db, strangerId, project)).toBeNull();
  });

  it('opens a project delivery filed outside the workspace to whoever may discuss it', async () => {
    const [acceptance] = await db
      .insert(acceptances)
      .values({
        projectId,
        subjectId: randomUUID(),
        subjectType: 'standalone',
        userId: ownerId,
        visibility: 'private',
        workspaceId: null,
      })
      .returning();
    const canRead = (userId: string) => canReadAcceptance({ serverDB: db, userId }, acceptance);

    await expect(
      resolveAcceptanceCommentAccess(db, teammateId, acceptance.id),
    ).resolves.toBeTruthy();
    expect(await canRead(teammateId)).toBe(true);
    expect(await canRead(viewerId)).toBe(true);
    await expect(resolveAcceptanceCommentAccess(db, strangerId, acceptance.id)).rejects.toThrow(
      TRPCError,
    );
    expect(await canRead(strangerId)).toBe(false);
  });

  it('keeps an only-me project delivery from teammates and project admins', async () => {
    await add(teammateId, 'admin');
    const [acceptance] = await db
      .insert(acceptances)
      .values({
        projectId,
        subjectId: randomUUID(),
        subjectType: 'standalone',
        userId: ownerId,
        visibility: 'owner',
        workspaceId,
      })
      .returning();
    const canRead = (userId: string) => canReadAcceptance({ serverDB: db, userId }, acceptance);

    expect(await canRead(ownerId)).toBe(true);
    expect(await canRead(teammateId)).toBe(false);
    expect(await canRead(viewerId)).toBe(false);
    await expect(resolveAcceptanceCommentAccess(db, teammateId, acceptance.id)).rejects.toThrow(
      TRPCError,
    );
    await expect(resolveAcceptanceCommentAccess(db, ownerId, acceptance.id)).resolves.toBeTruthy();
  });
});
