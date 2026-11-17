import { describe, expect, it, vi } from 'vitest';

import { SessionExecutionRuntime, type SessionService } from './index';

const createService = (): SessionService => ({
  archive: vi.fn().mockResolvedValue({}),
  get: vi.fn().mockResolvedValue({
    lastReply: 'Merged.',
    state: 'idle',
    title: 'Fix CI',
    topicId: 'tpc_child',
  }),
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
  start: vi.fn().mockResolvedValue({ branch: 'lobehub/1-x', topicId: 'tpc_child' }),
  stop: vi.fn().mockResolvedValue({ stopped: 1 }),
});

describe('SessionExecutionRuntime', () => {
  it('opens a sub-session of the current conversation, attributed to the running turn', async () => {
    const service = createService();
    const runtime = new SessionExecutionRuntime(service, {
      operationId: 'op_1',
      topicId: 'tpc_parent',
    });

    const result = await runtime.startSession({ prompt: 'Fix CI', workspace: 'new-worktree' });

    expect(service.start).toHaveBeenCalledWith({
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
    const runtime = new SessionExecutionRuntime(createService(), {});

    const result = await runtime.startSession({ prompt: 'x' });

    expect(result.success).toBe(false);
    expect(result.content).toMatch(/conversation/);
  });

  it('turns a service refusal into a readable failure', async () => {
    const service = createService();
    vi.mocked(service.send).mockRejectedValue(new Error('Agent relay limit reached'));
    const runtime = new SessionExecutionRuntime(service, { topicId: 'tpc_parent' });

    const result = await runtime.sendToSession({ message: 'again', topicId: 'tpc_child' });

    expect(result).toMatchObject({ content: 'Agent relay limit reached', success: false });
  });

  it('says a queued message waits behind the running turn', async () => {
    const service = createService();
    const runtime = new SessionExecutionRuntime(service, {
      operationId: 'op_1',
      topicId: 'tpc_parent',
    });

    const result = await runtime.sendToSession({ message: 'also docs', topicId: 'tpc_child' });

    expect(service.send).toHaveBeenCalledWith({
      message: 'also docs',
      sourceOperationId: 'op_1',
      topicId: 'tpc_child',
    });
    expect(result.content).toMatch(/queued/);
  });

  it('lists, reads and checks sub-sessions in a compact form', async () => {
    const runtime = new SessionExecutionRuntime(createService(), { topicId: 'tpc_parent' });

    expect((await runtime.listSessions()).content).toContain('tpc_child [running] Fix CI');
    expect((await runtime.readSession({ topicId: 'tpc_child' })).content).toBe(
      '[user] Fix CI\n\n[assistant] Done.',
    );
    expect((await runtime.getSession({ topicId: 'tpc_child' })).content).toContain('Merged.');
  });
});
