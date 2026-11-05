// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { type LobeChatDatabase } from '@lobechat/database';
import { acceptances } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceCommentModel } from '@/database/models/acceptanceComment';

import { acceptanceCommentRouter } from '../acceptanceComment';
import { cleanupTestUser, createTestUser } from './integration/setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

/**
 * Someone who may only remark on an acceptance can ask its deciders for the
 * right to send it back. The request is a discussion turn; the answer is
 * server-owned state the reject path reads.
 */
describe('acceptanceCommentRouter access requests', () => {
  let serverDB: LobeChatDatabase;
  let ownerId: string;
  let visitorId: string;
  let publicAcceptanceId: string;
  let privateAcceptanceId: string;
  let gateAcceptanceId: string;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    ownerId = await createTestUser(serverDB);
    visitorId = await createTestUser(serverDB);

    const [open, closed, gate] = await serverDB
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
        {
          subjectId: randomUUID(),
          subjectType: 'goal_gate',
          userId: ownerId,
          visibility: 'public',
        },
      ])
      .returning();
    publicAcceptanceId = open.id;
    privateAcceptanceId = closed.id;
    gateAcceptanceId = gate.id;
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, visitorId);
    await cleanupTestUser(serverDB, ownerId);
    vi.clearAllMocks();
  });

  const caller = (userId: string) =>
    acceptanceCommentRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  const request = (userId: string, acceptanceId = publicAcceptanceId, content?: string) =>
    caller(userId).requestAccess({ acceptanceId, clientId: `r-${randomUUID()}`, content });

  const granted = (userId: string) =>
    new AcceptanceCommentModel(serverDB).hasAccessGrant(publicAcceptanceId, userId, 'collaborate');

  it('lets a public-link visitor ask for reject access, as a pending discussion turn', async () => {
    const { data } = await request(visitorId, publicAcceptanceId, 'C2 still overlaps');

    expect(data).toMatchObject({
      accessRequest: { permission: 'collaborate', status: 'pending' },
      authorUserId: visitorId,
      content: 'C2 still overlaps',
      kind: 'access_request',
    });
    const list = await caller(ownerId).list({ acceptanceId: publicAcceptanceId });
    expect(list.items.map((item) => item.id)).toContain(data.id);
  });

  it('hands back the standing request instead of opening a second one', async () => {
    const first = await request(visitorId);
    const second = await request(visitorId);

    expect(second.data.id).toBe(first.data.id);
  });

  it('tells deciders, and only deciders, that they answer requests', async () => {
    await expect(caller(ownerId).list({ acceptanceId: publicAcceptanceId })).resolves.toMatchObject(
      { canManageAccess: true },
    );
    await expect(
      caller(visitorId).list({ acceptanceId: publicAcceptanceId }),
    ).resolves.toMatchObject({ canManageAccess: false });
  });

  it('refuses a request from the owner, who already holds everything a grant hands out', async () => {
    await expect(request(ownerId)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses a request on an acceptance the caller cannot read', async () => {
    await expect(request(visitorId, privateAcceptanceId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses a request on a goal gate, whose revision is the goal’s call', async () => {
    await expect(request(visitorId, gateAcceptanceId)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('lets only a decider answer', async () => {
    const { data } = await request(visitorId);

    await expect(
      caller(visitorId).answerAccessRequest({ decision: 'grant', id: data.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await granted(visitorId)).toBe(false);
  });

  it('grants reject access, records who granted it, and refuses a second answer', async () => {
    const { data } = await request(visitorId);

    const { data: answered } = await caller(ownerId).answerAccessRequest({
      decision: 'grant',
      id: data.id,
    });

    expect(answered.accessRequest).toMatchObject({
      decidedByUserId: ownerId,
      permission: 'collaborate',
      status: 'granted',
    });
    expect(await granted(visitorId)).toBe(true);
    await expect(
      caller(ownerId).answerAccessRequest({ decision: 'decline', id: data.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('takes a grant back on revoke, after which the visitor may ask again', async () => {
    const { data } = await request(visitorId);
    await caller(ownerId).answerAccessRequest({ decision: 'grant', id: data.id });

    await caller(ownerId).answerAccessRequest({ decision: 'revoke', id: data.id });

    expect(await granted(visitorId)).toBe(false);
    const again = await request(visitorId);
    expect(again.data.id).not.toBe(data.id);
    expect(again.data.accessRequest?.status).toBe('pending');
  });

  it('grants nothing on decline', async () => {
    const { data } = await request(visitorId);

    await caller(ownerId).answerAccessRequest({ decision: 'decline', id: data.id });

    expect(await granted(visitorId)).toBe(false);
  });

  it('gives a grant back when the requester withdraws the request', async () => {
    const { data } = await request(visitorId);
    await caller(ownerId).answerAccessRequest({ decision: 'grant', id: data.id });

    await caller(visitorId).delete({ id: data.id });

    expect(await granted(visitorId)).toBe(false);
  });

  it('never lets the generic create forge an access request', async () => {
    await expect(
      caller(visitorId).create({
        acceptanceId: publicAcceptanceId,
        clientId: `c-${randomUUID()}`,
        content: 'let me reject',
        kind: 'access_request' as any,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
