import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { projectMembers, users, workspaceMembers, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ProjectModel } from '../project';
import { ProjectMemberModel, ProjectSiteModel } from '../projectReview';
import { WorkspaceMemberModel } from '../workspaceMember';

const serverDB: LobeChatDatabase = await getTestDB();
const ownerId = 'project-review-owner';
const guestId = 'project-review-guest';

const createProject = () =>
  new ProjectModel(serverDB, ownerId).create({ identifier: 'SITE', name: 'Fieldnotes' });

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([
    { email: 'owner@fieldnotes.app', id: ownerId },
    { email: 'alex@studio-north.co', id: guestId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

describe('ProjectSiteModel', () => {
  const sites = new ProjectSiteModel(serverDB);

  it('finds a registered site by its ID', async () => {
    const project = await createProject();
    const site = await sites.create({
      createdByUserId: ownerId,
      name: 'Marketing site',
      origins: ['https://fieldnotes.app'],
      projectId: project.id,
    });

    expect(await sites.findById(site.id)).toEqual(
      expect.objectContaining({ id: site.id, projectId: project.id }),
    );
    expect(await sites.findById('psite_missing')).toBeNull();
  });

  it('lists, updates and deletes the sites of one project', async () => {
    const project = await createProject();
    const site = await sites.create({
      name: 'Staging',
      origins: ['https://staging.fieldnotes.app'],
      projectId: project.id,
    });

    expect(await sites.listByProject(project.id)).toEqual([
      expect.objectContaining({ id: site.id }),
    ]);

    const updated = await sites.update(project.id, site.id, {
      name: 'Preview',
      origins: ['http://localhost:3000'],
    });
    expect(updated).toEqual(
      expect.objectContaining({ name: 'Preview', origins: ['http://localhost:3000'] }),
    );

    await sites.delete(project.id, site.id);
    expect(await sites.listByProject(project.id)).toEqual([]);
  });
});

describe('ProjectMemberModel', () => {
  const members = new ProjectMemberModel(serverDB);
  let projectId: string;
  let workspaceId: string;

  beforeEach(async () => {
    const [workspace] = await serverDB
      .insert(workspaces)
      .values({
        name: 'Fieldnotes',
        primaryOwnerId: ownerId,
        slug: 'fieldnotes',
      })
      .returning();
    workspaceId = workspace.id;
    await serverDB.insert(workspaceMembers).values([
      { workspaceId, userId: ownerId, role: 'owner' },
      { workspaceId, userId: guestId },
    ]);
    projectId = (
      await new ProjectModel(serverDB, ownerId, workspaceId).create({
        identifier: 'SITE',
        name: 'Fieldnotes',
      })
    ).id;
  });

  it('links an existing workspace member once and updates the project role', async () => {
    const first = await members.add({ projectId, userId: guestId, role: 'member' });
    const second = await members.add({ projectId, userId: guestId, role: 'admin' });
    expect(second!.id).toBe(first!.id);
    expect(await members.findActive(projectId, guestId)).toMatchObject({ role: 'admin' });
    expect(await members.listByProject(projectId)).toHaveLength(1);
    await members.add({ projectId, userId: guestId, role: 'member' });
    expect(await members.findActive(projectId, guestId)).toMatchObject({ role: 'member' });
    await members.clearRole(workspaceId, projectId, guestId);
    expect(await members.findActive(projectId, guestId)).toBeNull();
  });

  it('rejects a personal project and an inactive workspace member', async () => {
    const personal = await createProject();
    await expect(
      members.add({ projectId: personal.id, userId: guestId, role: 'member' }),
    ).resolves.toBeNull();
    await serverDB
      .update(workspaceMembers)
      .set({ deletedAt: new Date() })
      .where(eq(workspaceMembers.userId, guestId));
    await expect(members.add({ projectId, userId: guestId, role: 'member' })).resolves.toBeNull();
  });

  it('rejects a member of another workspace', async () => {
    const [other] = await serverDB
      .insert(workspaces)
      .values({
        name: 'Other',
        primaryOwnerId: ownerId,
        slug: 'other',
      })
      .returning();
    await serverDB.insert(workspaceMembers).values({ workspaceId: other.id, userId: guestId });
    await serverDB.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
    await expect(members.add({ projectId, userId: guestId, role: 'member' })).resolves.toBeNull();
    expect(await serverDB.select().from(projectMembers)).toEqual([]);
  });

  it('revokes project access on workspace departure and does not restore it on rejoin', async () => {
    await members.add({ projectId, userId: guestId, role: 'admin' });
    const workspace = new WorkspaceMemberModel(serverDB, ownerId);
    await workspace.removeMember(workspaceId, guestId);
    expect(await members.findActive(projectId, guestId)).toBeNull();
    await workspace.addMember({ workspaceId, userId: guestId });
    expect(await members.findActive(projectId, guestId)).toBeNull();
    expect(await members.listByProject(projectId)).toEqual([]);
  });
});
