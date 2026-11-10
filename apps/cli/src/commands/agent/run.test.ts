import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAgentRunCommand } from './run';

const { mockExecAgent, mockGetTrpcClient, mockGetUserState } = vi.hoisted(() => ({
  mockExecAgent: vi.fn(),
  mockGetTrpcClient: vi.fn(),
  mockGetUserState: vi.fn(),
}));

vi.mock('../../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../../utils/agentStream', () => ({ replayAgentEvents: vi.fn() }));
vi.mock('./followRun', () => ({ followAgentRun: vi.fn() }));
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
    mockGetUserState.mockResolvedValue(undefined);
    mockGetTrpcClient.mockResolvedValue({
      aiAgent: { execAgent: { mutate: mockExecAgent } },
      user: { getUserState: { query: mockGetUserState } },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockExecAgent.mockReset();
  });

  it('declares the member-terminal stream feature so a group run keeps streaming', async () => {
    const input = await runAgent('--agent-id', 'agt-1', '--prompt', 'Hello');

    // Without it the server mirrors a member's terminal as `agent_runtime_end`,
    // which the Gateway treats as this session's end and closes the socket.
    expect(input.streamFeatures).toEqual(['member_runtime_end']);
  });

  it('retries without streamFeatures when an older server rejects the key', async () => {
    mockExecAgent
      .mockRejectedValueOnce(
        Object.assign(new Error('unrecognized_keys: ["streamFeatures"]'), {
          data: { code: 'BAD_REQUEST' },
        }),
      )
      .mockResolvedValueOnce({ operationId: 'op-1', success: true, topicId: 'tpc-1' });

    await runAgent('--agent-id', 'agt-1', '--prompt', 'Hello');

    expect(mockExecAgent).toHaveBeenCalledTimes(2);
    expect(mockExecAgent.mock.calls[1][0]).not.toHaveProperty('streamFeatures');
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

  it('defaults to headless approval when --no-headless is absent', async () => {
    const input = await runAgent('--agent-id', 'agt-1', '--prompt', 'Hello');

    expect(input.userInterventionConfig).toEqual({ approvalMode: 'headless' });
    // The saved user state is only consulted for --no-headless runs.
    expect(mockGetUserState).not.toHaveBeenCalled();
  });

  it('--no-headless sends the saved tool approval mode instead of headless', async () => {
    mockGetUserState.mockResolvedValue({
      settings: { tool: { humanIntervention: { approvalMode: 'manual' } } },
    });

    const input = await runAgent('--agent-id', 'agt-1', '--prompt', 'Hello', '--no-headless');

    expect(input.userInterventionConfig).toEqual({ approvalMode: 'manual' });
  });

  it('--no-headless falls back to manual when the state read fails', async () => {
    mockGetUserState.mockRejectedValue(new Error('network down'));

    const input = await runAgent('--agent-id', 'agt-1', '--prompt', 'Hello', '--no-headless');

    expect(input.userInterventionConfig).toEqual({ approvalMode: 'manual' });
  });

  it('--no-headless falls back to manual when no approval mode is saved', async () => {
    mockGetUserState.mockResolvedValue({ settings: { tool: {} } });

    const input = await runAgent('--agent-id', 'agt-1', '--prompt', 'Hello', '--no-headless');

    expect(input.userInterventionConfig).toEqual({ approvalMode: 'manual' });
  });

  it('--no-headless keeps the saved allow list in allow-list mode', async () => {
    mockGetUserState.mockResolvedValue({
      settings: {
        tool: {
          humanIntervention: {
            allowList: ['lobe-computer-use', 'my-mcp'],
            approvalMode: 'allow-list',
          },
        },
      },
    });

    const input = await runAgent('--agent-id', 'agt-1', '--prompt', 'Hello', '--no-headless');

    // GeneralChatAgent defaults an omitted allowList to [], which would park
    // again every tool the user previously approved.
    expect(input.userInterventionConfig).toEqual({
      allowList: ['lobe-computer-use', 'my-mcp'],
      approvalMode: 'allow-list',
    });
  });

  it('--no-headless sends an empty allow list when none is saved in allow-list mode', async () => {
    mockGetUserState.mockResolvedValue({
      settings: { tool: { humanIntervention: { approvalMode: 'allow-list' } } },
    });

    const input = await runAgent('--agent-id', 'agt-1', '--prompt', 'Hello', '--no-headless');

    expect(input.userInterventionConfig).toEqual({ allowList: [], approvalMode: 'allow-list' });
  });

  it('--no-headless normalizes a persisted headless mode to auto-run', async () => {
    // 'headless' is a backend-only value in the Web tool-intervention selector;
    // sending it back would convert intervention-required calls into blocked
    // results instead of parking them, defeating the explicit flag.
    mockGetUserState.mockResolvedValue({
      settings: { tool: { humanIntervention: { approvalMode: 'headless' } } },
    });

    const input = await runAgent('--agent-id', 'agt-1', '--prompt', 'Hello', '--no-headless');

    expect(input.userInterventionConfig).toEqual({ approvalMode: 'auto-run' });
  });
});
