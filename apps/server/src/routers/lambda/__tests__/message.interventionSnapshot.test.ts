// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertCanViewMessageTargets,
  assertCanViewTopicTargets,
} from '../_helpers/conversationResourceGuard';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => ({})) }));
vi.mock('@/business/server/trpc-middlewares/workspaceAuth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cloudWorkspaceAuth: (opts: any) => opts.next({ ctx: opts.ctx }),
}));
vi.mock('../_helpers/conversationResourceGuard', () => ({
  assertCanUseConversationTargets: vi.fn(),
  assertCanUseCreateMessageTargets: vi.fn(),
  assertCanUseMessageTargets: vi.fn(),
  assertCanUseTopicTargets: vi.fn(),
  assertCanViewMessageTargets: vi.fn(),
  assertCanViewTopicTargets: vi.fn(),
}));

const { getInterventionSnapshot } = vi.hoisted(() => ({ getInterventionSnapshot: vi.fn() }));
vi.mock('@/database/models/message', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  MessageModel: vi.fn(function () {
    return { getInterventionSnapshot };
  }),
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return {};
  }),
}));

const { messageRouter } = await import('../message');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('message.getInterventionSnapshot', () => {
  it('checks the topic and the cards, then returns the model snapshot', async () => {
    const snapshot = { revision: '3|t|h', statuses: { card: 'pending' } };
    getInterventionSnapshot.mockResolvedValue(snapshot);
    const caller = messageRouter.createCaller({ userId: 'owner', serverDB: {} } as any);

    const result = await caller.getInterventionSnapshot({ messageIds: ['card'], topicId: 'topic' });

    expect(result).toEqual(snapshot);
    expect(getInterventionSnapshot).toHaveBeenCalledWith({ ids: ['card'], topicId: 'topic' });
    expect(assertCanViewTopicTargets).toHaveBeenCalledWith(expect.anything(), ['topic']);
    expect(assertCanViewMessageTargets).toHaveBeenCalledWith(expect.anything(), ['card']);
  });

  it('reads nothing when the caller cannot view the topic', async () => {
    vi.mocked(assertCanViewTopicTargets).mockRejectedValueOnce(new Error('FORBIDDEN'));
    const caller = messageRouter.createCaller({ userId: 'owner', serverDB: {} } as any);

    await expect(
      caller.getInterventionSnapshot({ messageIds: ['card'], topicId: 'someone-else' }),
    ).rejects.toThrow('FORBIDDEN');
    expect(getInterventionSnapshot).not.toHaveBeenCalled();
  });
});
