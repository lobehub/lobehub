import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAgentRunCommand } from './run';

const { mockExecAgent, mockGetTrpcClient } = vi.hoisted(() => ({
  mockExecAgent: vi.fn(),
  mockGetTrpcClient: vi.fn(),
}));

vi.mock('../../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../../api/http', () => ({ getAgentStreamAuthInfo: vi.fn() }));
vi.mock('../../utils/agentStream', () => ({
  replayAgentEvents: vi.fn(),
  streamAgentEvents: vi.fn(),
  streamAgentEventsViaWebSocket: vi.fn(),
}));
vi.mock('../../utils/device', () => ({ resolveLocalDeviceId: vi.fn() }));

const runAgent = async (...args: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerAgentRunCommand(program.command('agent'));
  await program.parseAsync(['node', 'lh', 'agent', 'run', '--detach', ...args]);
  return mockExecAgent.mock.calls[0]?.[0];
};

describe('lh agent run', () => {
  beforeEach(() => {
    mockExecAgent.mockResolvedValue({ operationId: 'op-1', success: true, topicId: 'tpc-1' });
    mockGetTrpcClient.mockResolvedValue({ aiAgent: { execAgent: { mutate: mockExecAgent } } });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockExecAgent.mockReset();
  });

  it('enables each --tool for the run, as an @-mention in chat does', async () => {
    const input = await runAgent(
      '--agent-id',
      'agt-1',
      '--prompt',
      'Check the build',
      '--tool',
      'lobe-computer-use',
      '--tool',
      'my-mcp',
    );

    expect(input.selectedToolIds).toEqual(['lobe-computer-use', 'my-mcp']);
  });

  it('selects each --skill for the run, as picking it in chat does', async () => {
    const input = await runAgent(
      '--agent-id',
      'agt-1',
      '--prompt',
      'Audit the page',
      '--skill',
      'ux-audit',
      '--skill',
      'agent-skills:review',
    );

    expect(input.selectedSkillIds).toEqual(['ux-audit', 'agent-skills:review']);
  });

  it('sends neither field when no tool or skill is given', async () => {
    const input = await runAgent('--agent-id', 'agt-1', '--prompt', 'Hello');

    expect(input).not.toHaveProperty('selectedToolIds');
    expect(input).not.toHaveProperty('selectedSkillIds');
  });
});
