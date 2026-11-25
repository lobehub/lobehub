// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

import { buildCommands } from './commands';

const { findTopic, resolveMode } = vi.hoisted(() => ({ findTopic: vi.fn(), resolveMode: vi.fn() }));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = findTopic;
    resolveConversationMode = resolveMode;
  },
}));
vi.mock('@/server/services/aiAgent');

const mode = () =>
  buildCommands(
    {} as never,
    {
      agentId: 'agent',
      applicationId: 'app',
      userId: 'owner',
      platform: 'telegram',
    } as never,
  ).find((command) => command.name === 'mode')!;

const context = (args: string) => ({
  args,
  getState: async () => ({ topicId: 'topic', toolMode: 'agent' }),
  post: vi.fn().mockResolvedValue(undefined),
  replyLocale: 'en-US' as const,
  setState: vi.fn().mockResolvedValue(undefined),
  threadId: 'thread',
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveMode.mockResolvedValue('chat');
  findTopic.mockResolvedValue({ metadata: { conversationMode: 'chat' } });
});

it('refuses to switch an ongoing topic without changing its mode preference', async () => {
  const ctx = context('agent');
  await mode().handler(ctx);
  expect(ctx.setState).not.toHaveBeenCalled();
  expect(ctx.post.mock.calls[0][0]).toContain('/new');
});

it('reports the committed mode rather than a stale channel preference', async () => {
  const ctx = context('');
  await mode().handler(ctx);
  expect(ctx.post.mock.calls[0][0]).toContain('Chat');
});

it('still allows choosing a mode in a precreated empty topic', async () => {
  findTopic.mockResolvedValue({ metadata: {} });
  const ctx = context('chat');
  await mode().handler(ctx);
  expect(ctx.setState).toHaveBeenCalledWith({ toolMode: 'chat' });
});
