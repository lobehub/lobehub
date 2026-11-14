// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { sessionGroups, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { SessionGroupModel } from '../sessionGroup';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'session-group-team-pin-owner';
const memberId = 'session-group-team-pin-member';
const wsId = 'session-group-team-pin-ws';

const ownerModel = new SessionGroupModel(serverDB, ownerId, wsId);
const memberModel = new SessionGroupModel(serverDB, memberId, wsId);

const readPinned = async (id: string) =>
  (await serverDB.query.sessionGroups.findFirst({ where: eq(sessionGroups.id, id) }))?.pinned;

beforeEach(async () => {
  await serverDB.delete(users).where(eq(users.id, ownerId));
  await serverDB.delete(users).where(eq(users.id, memberId));
  await serverDB.insert(users).values([{ id: ownerId }, { id: memberId }]);
  await serverDB.insert(workspaces).values({
    id: wsId,
    name: 'Team Pin WS',
    primaryOwnerId: ownerId,
    slug: 'session-group-team-pin-ws',
  });
});

afterEach(async () => {
  await serverDB.delete(workspaces).where(eq(workspaces.id, wsId));
  await serverDB.delete(users).where(eq(users.id, ownerId));
  await serverDB.delete(users).where(eq(users.id, memberId));
});

describe('SessionGroupModel.updateTeamPinned', () => {
  it('sets and clears the team pin of a public workspace folder', async () => {
    const folder = await memberModel.create({ name: 'Shared', visibility: 'public' });
    expect(await readPinned(folder.id)).toBeNull();

    // Any member's public folder is reachable; the router gates the grant.
    expect(await ownerModel.updateTeamPinned(folder.id, true)).toBe(true);
    expect(await readPinned(folder.id)).toBe(true);

    expect(await ownerModel.updateTeamPinned(folder.id, false)).toBe(true);
    expect(await readPinned(folder.id)).toBe(false);
  });

  it('refuses a private folder, even the caller’s own', async () => {
    const folder = await ownerModel.create({ name: 'Mine', visibility: 'private' });

    expect(await ownerModel.updateTeamPinned(folder.id, true)).toBe(false);
    expect(await readPinned(folder.id)).toBeNull();
  });

  it('refuses another member’s private folder', async () => {
    const folder = await memberModel.create({ name: 'Theirs', visibility: 'private' });

    expect(await ownerModel.updateTeamPinned(folder.id, true)).toBe(false);
    expect(await readPinned(folder.id)).toBeNull();
  });

  it('is a no-op in personal mode', async () => {
    const personalModel = new SessionGroupModel(serverDB, ownerId);
    const folder = await personalModel.create({ name: 'Personal' });

    expect(await personalModel.updateTeamPinned(folder.id, true)).toBe(false);
    expect(await readPinned(folder.id)).toBeNull();
  });
});
