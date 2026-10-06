// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import {
  acceptances,
  agents,
  verifyRuns,
  workspaceMembers,
  workspaces,
} from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { acceptanceCommentRouter } from '../acceptanceComment';
import { cleanupTestUser, createTestUser } from './integration/setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

/**
 * A public acceptance is handed around as a link so other people can answer the
 * evidence in it. Reading it and remarking on it are therefore the same right;
 * approving a round, introducing one, and closing someone else's thread are not
 * — those speak for the delivery, and stay with its creator and their
 * workspace.
 */
describe('acceptanceCommentRouter access', () => {
  let serverDB: LobeChatDatabase;
  let ownerId: string;
  let visitorId: string;
  let publicAcceptanceId: string;
  let privateAcceptanceId: string;
  let publicRunId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    ownerId = await createTestUser(serverDB);
    visitorId = await createTestUser(serverDB);

    const [open, closed] = await serverDB
      .insert(acceptances)
      .values([
        {
          subjectId: randomUUID(),
          subjectType: 'standalone',
          userId: ownerId,
          visibility: 'public',
        },
        {
          subjectId: randomUUID(),
          subjectType: 'standalone',
          userId: ownerId,
          visibility: 'private',
        },
      ])
      .returning();
    publicAcceptanceId = open.id;
    privateAcceptanceId = closed.id;

    const [run] = await serverDB
      .insert(verifyRuns)
      .values({ acceptanceId: publicAcceptanceId, roundIndex: 1, userId: ownerId })
      .returning();
    publicRunId = run.id;
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, visitorId);
    await cleanupTestUser(serverDB, ownerId);
    vi.clearAllMocks();
  });

  const caller = (userId: string) =>
    acceptanceCommentRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  const comment = (userId: string, acceptanceId: string, content: string) =>
    caller(userId).create({ acceptanceId, clientId: `c-${randomUUID()}`, content });

  it('lets a visitor remark on a public acceptance', async () => {
    const { data } = await comment(visitorId, publicAcceptanceId, 'the second screenshot is stale');

    expect(data.authorUserId).toBe(visitorId);
  });

  it('lets a visitor react to a comment on a public acceptance', async () => {
    const { data: owned } = await comment(ownerId, publicAcceptanceId, 'round 1 is up');

    await expect(
      caller(visitorId).react({ emoji: '👍', id: owned.id, on: true }),
    ).resolves.toMatchObject({ data: { on: true } });
  });

  it('tells a visitor they may comment but not approve', async () => {
    const list = await caller(visitorId).list({ acceptanceId: publicAcceptanceId });

    expect(list).toMatchObject({ canApprove: false, canComment: true });
  });

  it('refuses a visitor an approval', async () => {
    await expect(
      caller(visitorId).create({
        acceptanceId: publicAcceptanceId,
        clientId: `c-${randomUUID()}`,
        content: 'looks good to me',
        contextRunId: publicRunId,
        kind: 'approval',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it("refuses a visitor a round's own introduction", async () => {
    await expect(
      caller(visitorId).create({
        acceptanceId: publicAcceptanceId,
        clientId: `c-${randomUUID()}`,
        content: 'round 2 delivered',
        contextRunId: publicRunId,
        kind: 'proposal',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it("refuses a visitor closing someone else's thread", async () => {
    const { data: owned } = await comment(ownerId, publicAcceptanceId, 'is this expected?');

    await expect(
      caller(visitorId).setResolved({ id: owned.id, resolved: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lets a visitor close the thread they opened', async () => {
    const { data: mine } = await comment(visitorId, publicAcceptanceId, 'never mind, my mistake');

    const { data } = await caller(visitorId).setResolved({ id: mine.id, resolved: true });

    expect(data.resolvedAt).not.toBeNull();
  });

  it("lets the creator take down a visitor's remark", async () => {
    const { data: theirs } = await comment(visitorId, publicAcceptanceId, 'buy my thing');

    const { data } = await caller(ownerId).delete({ id: theirs.id });

    expect(data.deleted).toBe(true);
  });

  it("refuses a visitor taking down the creator's remark", async () => {
    const { data: owned } = await comment(ownerId, publicAcceptanceId, 'round 1 is up');

    await expect(caller(visitorId).delete({ id: owned.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  // The discussion is open to whoever holds the link, so the cost of flooding
  // it has to land somewhere.
  it('refuses a visitor who floods the discussion', async () => {
    for (let index = 0; index < 10; index++)
      await comment(visitorId, publicAcceptanceId, `remark ${index}`);

    await expect(comment(visitorId, publicAcceptanceId, 'and one more')).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
  });

  // The ceiling is charged where the row is written, so a lost response that
  // gets retried answers with the row it already wrote.
  it('lets a visitor retry the remark that reached the ceiling', async () => {
    let lastClientId = '';
    for (let index = 0; index < 10; index++) {
      lastClientId = `c-${randomUUID()}`;
      await caller(visitorId).create({
        acceptanceId: publicAcceptanceId,
        clientId: lastClientId,
        content: `remark ${index}`,
      });
    }

    const { data } = await caller(visitorId).create({
      acceptanceId: publicAcceptanceId,
      clientId: lastClientId,
      content: 'remark 9',
    });

    expect(data.content).toBe('remark 9');
  });

  // The refusal rolls the write back with it: a rejected remark must not be
  // half-written, or the next window starts already over the line.
  it('writes nothing when the ceiling refuses a remark', async () => {
    for (let index = 0; index < 10; index++)
      await comment(visitorId, publicAcceptanceId, `remark ${index}`);
    const before = await caller(visitorId).list({ acceptanceId: publicAcceptanceId });

    await expect(comment(visitorId, publicAcceptanceId, 'one too many')).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });

    const after = await caller(visitorId).list({ acceptanceId: publicAcceptanceId });
    expect(after.items).toHaveLength(before.items.length);
  });

  it('does not throttle the creator publishing a round', async () => {
    for (let index = 0; index < 12; index++)
      await comment(ownerId, publicAcceptanceId, `note ${index}`);

    await expect(comment(ownerId, publicAcceptanceId, 'still fine')).resolves.toBeTruthy();
  });

  it('keeps a private acceptance invisible to a visitor', async () => {
    await expect(comment(visitorId, privateAcceptanceId, 'hello?')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

/**
 * An acceptance filed in a workspace carries that workspace's agents in its
 * discussion payload. Opening the link hands a stranger those ids; it must not
 * hand them the right to post under them.
 */
describe('acceptanceCommentRouter workspace scoping', () => {
  let serverDB: LobeChatDatabase;
  let ownerId: string;
  let viewerId: string;
  let visitorId: string;
  let workspaceId: string;
  let workspaceAgentId: string;
  let openAcceptanceId: string;
  let closedAcceptanceId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    ownerId = await createTestUser(serverDB);
    viewerId = await createTestUser(serverDB);
    visitorId = await createTestUser(serverDB);

    const [workspace] = await serverDB
      .insert(workspaces)
      .values({ name: 'Delivery team', primaryOwnerId: ownerId, slug: `ws-${ownerId}` })
      .returning();
    workspaceId = workspace.id;
    await serverDB.insert(workspaceMembers).values([
      { role: 'owner', userId: ownerId, workspaceId },
      { role: 'viewer', userId: viewerId, workspaceId },
    ]);

    workspaceAgentId = `agt_${randomUUID()}`;
    await serverDB.insert(agents).values({
      id: workspaceAgentId,
      slug: workspaceAgentId,
      title: 'Delivery Bot',
      userId: ownerId,
      visibility: 'public',
      workspaceId,
    });

    const [open, closed] = await serverDB
      .insert(acceptances)
      .values([
        {
          subjectId: randomUUID(),
          subjectType: 'standalone',
          userId: ownerId,
          visibility: 'public',
          workspaceId,
        },
        {
          subjectId: randomUUID(),
          subjectType: 'standalone',
          userId: ownerId,
          visibility: 'private',
          workspaceId,
        },
      ])
      .returning();
    openAcceptanceId = open.id;
    closedAcceptanceId = closed.id;
  });

  afterEach(async () => {
    await serverDB.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await cleanupTestUser(serverDB, visitorId);
    await cleanupTestUser(serverDB, viewerId);
    await cleanupTestUser(serverDB, ownerId);
    vi.clearAllMocks();
  });

  const caller = (userId: string) =>
    acceptanceCommentRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  it("refuses a visitor signing as the workspace's agent", async () => {
    await expect(
      caller(visitorId).create({
        acceptanceId: openAcceptanceId,
        authorAgentId: workspaceAgentId,
        clientId: `c-${randomUUID()}`,
        content: 'looks done to me',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("lets the creator sign as the workspace's agent", async () => {
    const { data } = await caller(ownerId).create({
      acceptanceId: openAcceptanceId,
      authorAgentId: workspaceAgentId,
      clientId: `c-${randomUUID()}`,
      content: 'round 1 delivered',
    });

    expect(data.author).toMatchObject({ id: workspaceAgentId, type: 'agent' });
  });

  it('still lets a visitor remark under their own name', async () => {
    const { data } = await caller(visitorId).create({
      acceptanceId: openAcceptanceId,
      clientId: `c-${randomUUID()}`,
      content: 'the export path is missing',
    });

    expect(data.authorUserId).toBe(visitorId);
  });

  // Read-only in the workspace means read-only on its private deliveries, the
  // same rule topic and document comments enforce.
  it('keeps a workspace viewer read-only on a private delivery', async () => {
    await expect(
      caller(viewerId).create({
        acceptanceId: closedAcceptanceId,
        clientId: `c-${randomUUID()}`,
        content: 'can I write here?',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lets a workspace viewer remark once the delivery is public', async () => {
    const { data } = await caller(viewerId).create({
      acceptanceId: openAcceptanceId,
      clientId: `c-${randomUUID()}`,
      content: 'reading it from the link like everyone else',
    });

    expect(data.authorUserId).toBe(viewerId);
  });
});
