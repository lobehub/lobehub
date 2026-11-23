// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assertCanViewMessageTargets } from '../_helpers/conversationResourceGuard';

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

const { listMessagePluginsByIds } = vi.hoisted(() => ({ listMessagePluginsByIds: vi.fn() }));
vi.mock('@/database/models/message', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  MessageModel: vi.fn(function () {
    return { listMessagePluginsByIds };
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

describe('message.getInterventionStatuses', () => {
  it('returns each card status and null for a card the topic no longer has', async () => {
    listMessagePluginsByIds.mockResolvedValue([
      { id: 'pending-card', intervention: { status: 'pending' } },
      { id: 'answered-card', intervention: { status: 'approved' } },
    ]);
    const caller = messageRouter.createCaller({ userId: 'owner', serverDB: {} } as any);
    const messageIds = ['pending-card', 'answered-card', 'deleted-card'];

    const result = await caller.getInterventionStatuses({ messageIds, topicId: 'topic' });

    expect(result).toEqual({
      'answered-card': 'approved',
      'deleted-card': null,
      'pending-card': 'pending',
    });
    expect(listMessagePluginsByIds).toHaveBeenCalledWith({ ids: messageIds, topicId: 'topic' });
    expect(assertCanViewMessageTargets).toHaveBeenCalledWith(expect.anything(), messageIds);
  });
});
