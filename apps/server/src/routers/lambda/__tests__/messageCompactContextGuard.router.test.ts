// @vitest-environment node
import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/server/services/message', () => ({
  MessageService: vi.fn(function () {
    return {};
  }),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return {};
  }),
}));

const mockCompactContext = vi.fn();
vi.mock('@/server/services/contextCompaction', () => ({
  ContextCompactionService: vi.fn(function () {
    return { compact: mockCompactContext };
  }),
}));

const mockAssertCanUseTopicTargets = vi.fn();
const mockAssertCanUseConversationTargets = vi.fn();
vi.mock('../_helpers/conversationResourceGuard', () => ({
  assertCanUseConversationTargets: (...args: unknown[]) =>
    mockAssertCanUseConversationTargets(...args),
  assertCanUseCreateMessageTargets: vi.fn(async () => []),
  assertCanUseMessageTargets: vi.fn(async () => {}),
  assertCanUseTopicTargets: (...args: unknown[]) => mockAssertCanUseTopicTargets(...args),
  assertCanViewMessageTargets: vi.fn(async () => {}),
}));

vi.mock('../_helpers/shareVisitorTargetGuard', () => ({
  assertCreatorMessageTargets: vi.fn(async () => {}),
  assertCreatorTopicTargets: vi.fn(async () => {}),
}));

const { messageRouter } = await import('../message');

const caller = () => messageRouter.createCaller({ userId: 'user-1' } as any);

describe('message.compactContext agent authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertCanUseTopicTargets.mockResolvedValue([]);
    mockAssertCanUseConversationTargets.mockResolvedValue([]);
    mockCompactContext.mockResolvedValue({ messages: [], skipped: true });
  });

  it('requires USE access to the client-supplied agent/group that pays for the model call', async () => {
    await caller().compactContext({ agentId: 'agt_public', groupId: 'grp_1', topicId: 'tpc_1' });

    expect(mockAssertCanUseConversationTargets).toHaveBeenCalledWith(expect.anything(), [
      { agentId: 'agt_public', groupId: 'grp_1' },
    ]);
    expect(mockCompactContext).toHaveBeenCalled();
  });

  it('does not compact when the supplied agent is only viewable', async () => {
    mockAssertCanUseConversationTargets.mockRejectedValue(new TRPCError({ code: 'FORBIDDEN' }));

    await expect(
      caller().compactContext({ agentId: 'agt_view_only', topicId: 'tpc_1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(mockCompactContext).not.toHaveBeenCalled();
  });
});
