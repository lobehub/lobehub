import { describe, expect, it, vi } from 'vitest';

import { type SubTopicToolService, TopicToolExecutionRuntime } from './index';

const createService = (): SubTopicToolService => ({
  archive: vi.fn().mockResolvedValue({}),
  get: vi.fn().mockResolvedValue({
    lastReply: 'Merged.',
    state: 'idle',
    title: 'Fix CI',
    topicId: 'tpc_child',
  }),
  isOpenedBy: vi.fn().mockResolvedValue(true),
  list: vi
    .fn()
    .mockResolvedValue([
      { agentId: 'agt_codex', state: 'running', title: 'Fix CI', topicId: 'tpc_child' },
    ]),
  read: vi.fn().mockResolvedValue({
    items: [
      { content: 'Fix CI', role: 'user' },
      { content: 'Done.', role: 'assistant' },
    ],
  }),
  send: vi.fn().mockResolvedValue({ delivery: 'queued' }),
  open: vi.fn().mockResolvedValue({ branch: 'lobehub/1-x', topicId: 'tpc_child' }),
  stop: vi.fn().mockResolvedValue({ stopped: 1 }),
});

describe('TopicToolExecutionRuntime', () => {
  it('opens a sub-topic of the current conversation, attributed to the running turn', async () => {
    const service = createService();
    const runtime = new TopicToolExecutionRuntime(service, {
      operationId: 'op_1',
      topicId: 'tpc_parent',
    });

    const result = await runtime.openTopic({ prompt: 'Fix CI', workspace: 'new-worktree' });

    expect(service.open).toHaveBeenCalledWith({
      openerTopicId: 'tpc_parent',
      prompt: 'Fix CI',
      sourceOperationId: 'op_1',
      workspace: 'new-worktree',
    });
    expect(result.success).toBe(true);
    expect(result.content).toContain('tpc_child');
    expect(result.content).toContain('lobehub/1-x');
    expect(result.content).toContain('do not poll');
  });

  it('refuses outside a conversation', async () => {
    const runtime = new TopicToolExecutionRuntime(createService(), {});

    const result = await runtime.openTopic({ prompt: 'x' });

    expect(result.success).toBe(false);
    expect(result.content).toMatch(/conversation/);
  });

  it('turns a service refusal into a readable failure', async () => {
    const service = createService();
    vi.mocked(service.send).mockRejectedValue(new Error('Agent relay limit reached'));
    const runtime = new TopicToolExecutionRuntime(service, { topicId: 'tpc_parent' });

    const result = await runtime.sendToTopic({ message: 'again', topicId: 'tpc_child' });

    expect(result).toMatchObject({ content: 'Agent relay limit reached', success: false });
  });

  it('says a queued message waits behind the running turn', async () => {
    const service = createService();
    const runtime = new TopicToolExecutionRuntime(service, {
      operationId: 'op_1',
      topicId: 'tpc_parent',
    });

    const result = await runtime.sendToTopic({ message: 'also docs', topicId: 'tpc_child' });

    expect(service.send).toHaveBeenCalledWith({
      message: 'also docs',
      sourceOperationId: 'op_1',
      topicId: 'tpc_child',
    });
    expect(result.content).toMatch(/queued/);
  });

  it('lists, reads and checks sub-topics in a compact form', async () => {
    const runtime = new TopicToolExecutionRuntime(createService(), { topicId: 'tpc_parent' });

    expect((await runtime.listTopics()).content).toContain('tpc_child [running] Fix CI');
    expect((await runtime.readTopic({ topicId: 'tpc_child' })).content).toBe(
      '[user] Fix CI\n\n[assistant] Done.',
    );
    expect((await runtime.getTopic({ topicId: 'tpc_child' })).content).toContain('Merged.');
  });

  it('says a detached topic will not report back', async () => {
    const runtime = new TopicToolExecutionRuntime(createService(), { topicId: 'tpc_parent' });

    const result = await runtime.openTopic({ detach: true, prompt: 'x' });

    expect(result.content).toMatch(/detached: it is not linked/);
  });
});
