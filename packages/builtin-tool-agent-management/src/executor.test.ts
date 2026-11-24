import { LEGACY_CALL_AGENT_NOTE } from '@lobechat/builtin-tool-lobe-agent';
import type { BuiltinToolContext } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { agentManagementExecutor } from './executor';

// Renderer aliases the executors import; nothing here reaches them.
vi.mock('@/services/agent', () => ({ agentService: {} }));
vi.mock('@/services/discover', () => ({ discoverService: {} }));
vi.mock('@/services/notebook', () => ({ notebookService: {} }));
vi.mock('@/store/notebook', () => ({ useNotebookStore: { getState: () => ({}) } }));
vi.mock('@lobechat/agent-manager-runtime', () => ({ AgentManagerRuntime: vi.fn() }));

const ctxWith = (run: ReturnType<typeof vi.fn>, extra: Partial<BuiltinToolContext> = {}) =>
  ({ messageId: 'tool-msg-1', subAgent: { run }, ...extra }) as unknown as BuiltinToolContext;

// `callAgent` is retired; old calls forward to `lobe-agent.callSubAgent({ agentId })`.
describe('agentManagementExecutor.callAgent alias', () => {
  it('runs the target as a sub-agent and asks the model to switch', async () => {
    const run = vi.fn().mockResolvedValue({ result: 'A poem', success: true, threadId: 'thd_1' });

    const result = await agentManagementExecutor.callAgent(
      { agentId: 'agent-poet', instruction: 'Write a poem' },
      ctxWith(run),
    );

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ instruction: 'Write a poem', targetAgentId: 'agent-poet' }),
    );
    expect(result).toMatchObject({ state: { targetAgentId: 'agent-poet' }, success: true });
    expect(result.content).toBe(`A poem\n\n${LEGACY_CALL_AGENT_NOTE}`);
  });

  it('keeps the client limits of callSubAgent', async () => {
    const run = vi.fn();

    const result = await agentManagementExecutor.callAgent(
      { agentId: 'agent-poet', instruction: 'Write a poem', runInBackground: true },
      ctxWith(run),
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain('without runInBackground');
    expect(run).not.toHaveBeenCalled();
  });

  // In a group, members answer through group-management `speak`.
  it('points to speak in a group instead of calling the member', async () => {
    const run = vi.fn();

    const result = await agentManagementExecutor.callAgent(
      { agentId: 'agent-poet', instruction: 'Write a poem' },
      ctxWith(run, { groupId: 'group-1' }),
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain('`speak`');
    expect(run).not.toHaveBeenCalled();
  });
});
