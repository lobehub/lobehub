// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { projects, topics } from '@lobechat/database/schemas';
import { getTestDB } from '@lobechat/database/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { artboardRouter } from '../artboard';
import { createTestUser } from './integration/setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(() => testDB),
}));

describe('artboardRouter', () => {
  let userId: string;
  let topicId: string;

  beforeEach(async () => {
    testDB = await getTestDB();
    userId = await createTestUser(testDB);
    const projectId = `prj_${userId}`;
    topicId = `tpc_${userId}`;
    await testDB.insert(projects).values({ id: projectId, name: 'Onboarding', userId });
    await testDB.insert(topics).values({ id: topicId, projectId, title: '讨论', userId });
  });

  const caller = () => artboardRouter.createCaller({ jwtPayload: { userId }, userId } as any);

  const createBoard = () =>
    caller().create({
      ops: [{ group: { kind: 'journey', title: '旅程' }, ref: 'j', type: 'addGroup' }],
      title: '首次进入',
      topicId,
    });

  it('creates a board and reads it back by revision', async () => {
    const { artboard } = await createBoard();
    expect(await caller().getRevision({ id: artboard.id })).toBe(1);
    expect((await caller().list({ topicId })).map((item) => item.id)).toEqual([artboard.id]);
  });

  it('maps a stale revision to CONFLICT', async () => {
    const { artboard } = await createBoard();
    const groupId = artboard.content.groups[0].id;
    await caller().update({
      id: artboard.id,
      ops: [{ id: groupId, patch: { title: '主流程' }, type: 'updateGroup' }],
      revision: 1,
    });

    await expect(
      caller().update({
        id: artboard.id,
        ops: [{ id: groupId, patch: { title: '旅程' }, type: 'updateGroup' }],
        revision: 1,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('threads a comment through the router without touching the revision', async () => {
    const { artboard } = await createBoard();
    const thread = await caller().addComment({
      anchor: { type: 'canvas', x: 12, y: 40 },
      clientId: 'c1',
      content: '要跳过吗？',
      id: artboard.id,
    });
    await caller().replyComment({ clientId: 'c2', commentId: thread.id, content: '可以' });
    await caller().resolveComment({ commentId: thread.id });

    const [listed] = await caller().listComments({ id: artboard.id });
    expect(listed).toMatchObject({
      anchor: { type: 'canvas', x: 12, y: 40 },
      replies: [{ content: '可以' }],
    });
    expect(listed.resolvedAt).toBeInstanceOf(Date);
    expect(await caller().getRevision({ id: artboard.id })).toBe(1);
  });

  it('maps a round that is not on the board to NOT_FOUND', async () => {
    const { artboard } = await createBoard();
    await expect(
      caller().submitRound({ id: artboard.id, roundId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('maps a blocked finalize to PRECONDITION_FAILED with what is missing', async () => {
    const { artboard } = await createBoard();
    const error = await caller()
      .finalize({ id: artboard.id, revision: 1 })
      .catch((caught) => caught);

    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(error.cause.data.issues).toEqual([{ code: 'empty_journey' }]);
  });
});
