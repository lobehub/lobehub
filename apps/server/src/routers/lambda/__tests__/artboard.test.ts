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
      ops: [
        { group: { kind: 'journey', title: '旅程' }, ref: 'j', type: 'addGroup' },
        { note: { kind: 'sticky', question: {}, text: '要跳过吗？', x: 0, y: 0 }, type: 'addNote' },
      ],
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
    await caller().applyUserOps({
      id: artboard.id,
      ops: [{ id: 'n1', text: '可以跳过吗？', type: 'updateNoteText' }],
      revision: 1,
    });

    await expect(
      caller().applyUserOps({
        id: artboard.id,
        ops: [{ id: 'n1', type: 'moveItem', x: 10, y: 10 }],
        revision: 1,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('maps a blocked finalize to PRECONDITION_FAILED with what is missing', async () => {
    const { artboard } = await createBoard();
    const error = await caller()
      .finalize({ id: artboard.id, revision: 1 })
      .catch((caught) => caught);

    expect(error).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(error.cause.data.issues).toEqual([
      { code: 'empty_journey' },
      { code: 'open_question', noteId: 'n1' },
    ]);
  });
});
