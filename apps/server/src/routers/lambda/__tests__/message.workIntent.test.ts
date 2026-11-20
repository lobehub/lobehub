// @vitest-environment node
import type { UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('../_helpers/resolveContext', () => ({ resolveContext: vi.fn(async (input) => input) }));

const { query, queryByCursor, findShare } = vi.hoisted(() => ({
  query: vi.fn(),
  queryByCursor: vi.fn(),
  findShare: vi.fn(),
}));
vi.mock('@/database/models/message', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  MessageModel: vi.fn(function () {
    return { query, queryTopicMessagesByCursor: queryByCursor };
  }),
}));
vi.mock('@/database/models/topicShare', () => ({
  TopicShareModel: { findByShareIdWithAccessCheck: findShare },
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return {};
  }),
}));

const { messageRouter } = await import('../message');
const intent = {
  type: 'skill' as const,
  provider: 'test',
  toolName: 'skill',
  args: { raw: 'arguments' },
  data: 'untruncated skill data',
};
const message = {
  id: 'tool-result',
  role: 'tool',
  content: 'truncated result',
  metadata: { toolWorkRegistration: intent, toolResultSuccess: true },
} as UIChatMessage;

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue([
    message,
    {
      id: 'group',
      role: 'compressedGroup',
      content: '',
      compressedMessages: [message],
      members: [message],
      columns: [[message]],
    },
  ]);
  queryByCursor.mockResolvedValue({
    messages: [
      message,
      {
        id: 'group',
        role: 'compressedGroup',
        content: '',
        compressedMessages: [message],
        members: [message],
        columns: [[message]],
      },
    ],
    hasMore: false,
    nextCursor: null,
  });
  findShare.mockResolvedValue({ ownerId: 'owner', topicId: 'topic' });
});

describe('message lists omit durable replay-only Work intents', () => {
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])('ordinary list (share=%s, projected=%s)', async (shared, projected) => {
    const caller = messageRouter.createCaller({ userId: 'owner', serverDB: {} } as any);
    const result = await caller.getMessages({
      topicId: 'topic',
      projectToolPayloads: projected,
      ...(shared && { topicShareId: 'share' }),
    });
    expect(result[0].metadata).toEqual({ toolResultSuccess: true });
    expect(JSON.stringify(result)).not.toContain('untruncated skill data');
    expect(message.metadata?.toolWorkRegistration).toEqual(intent);
    if (!projected || shared) expect(result[0].content).toBe('truncated result');
  });

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])('cursor page (share=%s, projected=%s)', async (shared, projected) => {
    const caller = messageRouter.createCaller({ userId: 'owner', serverDB: {} } as any);
    const result = await caller.getMessagesByCursor({
      topicId: 'topic',
      projectToolPayloads: projected,
      ...(shared && { topicShareId: 'share' }),
    });
    expect(result.messages[0].metadata).toEqual({ toolResultSuccess: true });
    expect(JSON.stringify(result.messages)).not.toContain('untruncated skill data');
    expect(result.hasMore).toBe(false);
    expect(message.metadata?.toolWorkRegistration).toEqual(intent);
  });
});
