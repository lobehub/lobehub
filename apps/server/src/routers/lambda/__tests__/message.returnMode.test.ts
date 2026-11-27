// @vitest-environment node
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
vi.mock('../_helpers/shareVisitorTargetGuard', () => ({
  assertCreatorMessageTargets: vi.fn(),
  assertCreatorTopicTargets: vi.fn(),
}));
vi.mock('../_helpers/resolveContext', () => ({
  resolveContext: vi.fn(async (input) => ({
    agentId: input.agentId ?? null,
    groupId: input.groupId ?? null,
    sessionId: input.sessionId ?? null,
    threadId: input.threadId ?? null,
    topicId: input.topicId ?? null,
  })),
}));

const model = vi.hoisted(() => ({
  query: vi.fn(),
  update: vi.fn(),
  updateMessagePlugin: vi.fn(),
  updateMetadata: vi.fn(),
  updatePluginState: vi.fn(),
  updateToolArguments: vi.fn(),
  updateToolMessage: vi.fn(),
}));
vi.mock('@/database/models/message', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  MessageModel: vi.fn(function () {
    return model;
  }),
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return {};
  }),
}));

const { messageRouter } = await import('../message');

const topic = { agentId: 'agent-1', topicId: 'topic-1' };
const list = [{ id: 'msg-1', role: 'user', content: 'x' }];

beforeEach(() => {
  vi.clearAllMocks();
  model.query.mockResolvedValue(list);
  model.update.mockResolvedValue({ success: true });
  model.updateToolArguments.mockResolvedValue({ success: true });
  model.updateToolMessage.mockResolvedValue({ success: true });
});

describe('message mutations returnMode', () => {
  const caller = () => messageRouter.createCaller({ userId: 'owner', serverDB: {} } as any);

  it('returns the full list when returnMode is omitted (CLI / mobile / older bundles)', async () => {
    const result = await caller().update({ ...topic, id: 'msg-1', value: { content: 'y' } });

    expect(result).toEqual({ messages: list, success: true });
    expect(model.query).toHaveBeenCalledTimes(1);
  });

  it('skips the topic re-read for every row-local mutation in delta mode', async () => {
    const delta = { ...topic, returnMode: 'delta' as const };

    const results = await Promise.all([
      caller().update({ ...delta, id: 'msg-1', value: { content: 'y' } }),
      caller().updateMetadata({ ...delta, id: 'msg-1', value: { collapsed: true } }),
      caller().updatePluginState({ ...delta, id: 'msg-1', value: { a: 1 } }),
      caller().updateMessagePlugin({ ...delta, id: 'msg-1', value: { arguments: '{}' } }),
      caller().updateToolMessage({ ...delta, id: 'msg-1', value: { content: 'r' } }),
      caller().updateToolArguments({ ...delta, toolCallId: 'call-1', value: '{}' }),
    ]);

    expect(results.every((result) => result.success && !('messages' in result))).toBe(true);
    expect(model.query).not.toHaveBeenCalled();
  });
});
