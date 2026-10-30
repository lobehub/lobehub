// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { projectMembers, projects, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ProjectMemberModel, ProjectSiteModel } from '../projectReview';

const userId = 't863-proj-review-user';
const workspaceId = 't863-proj-review-ws';
const projectId = 't863-proj-review-project';

const serverDB: LobeChatDatabase = await getTestDB();

const sites = new ProjectSiteModel(serverDB);
const members = new ProjectMemberModel(serverDB);

beforeEach(async () => {
  await serverDB.insert(users).values({ id: userId });
  await serverDB.insert(projects).values({ id: projectId, name: 'Review', userId });
});

afterEach(async () => {
  // Projects, sites and members cascade with their owner; the workspace is ours alone.
  await serverDB.delete(workspaces).where(inArray(workspaces.id, [workspaceId]));
  await serverDB.delete(users).where(inArray(users.id, [userId]));
});

describe('ProjectSiteModel coverage', () => {
  it('returns null when updating or deleting a site that does not exist', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';

    expect(await sites.update(projectId, missing, { name: 'Renamed' })).toBeNull();
    expect(await sites.delete(projectId, missing)).toBeNull();
  });

  it('does not touch a site through another project', async () => {
    const site = await sites.create({ name: 'Site', origins: ['https://a.test'], projectId });

    expect(await sites.update('t863-proj-review-other', site.id, { name: 'X' })).toBeNull();
    expect(await sites.delete('t863-proj-review-other', site.id)).toBeNull();
    expect(await sites.findById(site.id)).toEqual(expect.objectContaining({ name: 'Site' }));
  });
});

describe('ProjectMemberModel coverage', () => {
  it('finds a member by id and returns null for an unknown id', async () => {
    await serverDB
      .insert(workspaces)
      .values({ id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: 't863-proj-review-ws' });
    const [member] = await serverDB
      .insert(projectMembers)
      .values({ projectId, role: 'admin', userId, workspaceId })
      .returning();

    expect(await members.findById(member.id)).toEqual(
      expect.objectContaining({ id: member.id, role: 'admin', userId }),
    );
    expect(await members.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('returns null when clearing a role nobody holds', async () => {
    expect(await members.clearRole(workspaceId, projectId, userId)).toBeNull();
  });
});
