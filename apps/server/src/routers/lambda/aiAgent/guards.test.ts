// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertCanUseMessageTargets,
  assertCanUseTopicTargets,
} from '@/server/routers/lambda/_helpers/conversationResourceGuard';

import { assertCanUseAgentRunConversation } from './guards';

vi.mock('@/server/routers/lambda/_helpers/conversationResourceGuard', () => ({
  assertCanUseMessageTargets: vi.fn(async () => []),
  assertCanUseTopicTargets: vi.fn(async () => []),
}));

const db = {} as any;

describe('assertCanUseAgentRunConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('authorizes the topic a new topic is opened from, alongside the conversation', async () => {
    await assertCanUseAgentRunConversation({
      db,
      openedByTopicId: 'tpc_opener',
      topicId: 'tpc_conversation',
      userId: 'user-1',
      workspaceId: 'ws-1',
    });

    expect(assertCanUseTopicTargets).toHaveBeenCalledWith(
      { db, userId: 'user-1', workspaceId: 'ws-1' },
      ['tpc_conversation', 'tpc_opener'],
    );
  });

  it('authorizes the opener of a brand-new topic on its own', async () => {
    await assertCanUseAgentRunConversation({
      db,
      openedByTopicId: 'tpc_opener',
      userId: 'user-1',
      workspaceId: 'ws-1',
    });

    expect(assertCanUseTopicTargets).toHaveBeenCalledWith(expect.anything(), ['tpc_opener']);
  });

  it('refuses when the caller may not use the opener', async () => {
    vi.mocked(assertCanUseTopicTargets).mockRejectedValueOnce(new Error('FORBIDDEN'));

    await expect(
      assertCanUseAgentRunConversation({
        db,
        openedByTopicId: 'tpc_view_only',
        userId: 'user-1',
        workspaceId: 'ws-1',
      }),
    ).rejects.toThrow('FORBIDDEN');
  });

  it('checks nothing outside a workspace, where every topic is the caller own', async () => {
    await assertCanUseAgentRunConversation({ db, openedByTopicId: 'tpc_opener', userId: 'user-1' });

    expect(assertCanUseTopicTargets).not.toHaveBeenCalled();
    expect(assertCanUseMessageTargets).not.toHaveBeenCalled();
  });
});
