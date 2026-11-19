import { PassThrough } from 'node:stream';

import type { LocalHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import { HETEROGENEOUS_AGENT_CONFIGS } from '@lobechat/heterogeneous-agents';
import { HETERO_EXEC_INHERIT_PROCESS_GROUP_ENV } from '@lobechat/heterogeneous-agents/protocol';
import type * as HeteroSpawn from '@lobechat/heterogeneous-agents/spawn';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerHeteroCommand } from './index';

const {
  mockForceKillProcessTree,
  mockGetTrpcClient,
  mockHeteroFinishMutate,
  mockResolveHeteroSpawnCommand,
  mockSpawnAgent,
} = vi.hoisted(() => ({
  mockForceKillProcessTree: vi.fn(),
  mockGetTrpcClient: vi.fn(),
  mockHeteroFinishMutate: vi.fn(),
  mockResolveHeteroSpawnCommand: vi.fn(),
  mockSpawnAgent: vi.fn(),
}));

vi.mock('@lobechat/heterogeneous-agents/spawn', async (importOriginal) => ({
  ...(await importOriginal<typeof HeteroSpawn>()),
  spawnAgent: mockSpawnAgent,
}));
vi.mock('@lobechat/heterogeneous-agents/resolveCliCommand', () => ({
  resolveHeteroSpawnCommand: mockResolveHeteroSpawnCommand,
}));
vi.mock('../../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../../utils/OperationTokenRenewal', () => ({
  createOperationTokenRenewal: () => ({ active: true, stop: vi.fn() }),
}));
vi.mock('../../utils/processTree', () => ({ forceKillProcessTree: mockForceKillProcessTree }));
// The ask-user MCP server is real I/O; this suite is about the watchdog.
vi.mock('@lobechat/heterogeneous-agents/builtinMcp', () => ({
  LobeBuiltinMcpServer: class {
    registerOperation = (_id: string, bridge: unknown) => bridge;
    start = async () => {};
    stop = async () => {};
    unregisterOperation = () => {};
    urlForOperation = () => 'http://127.0.0.1:1/mcp';
  },
}));

const MIN = 60_000;

/** A Claude Code process that emits `events` and then hangs until it is killed. */
const hangingHandle = (events: any[]) => {
  let markKilled!: () => void;
  const killed = new Promise<void>((resolve) => (markKilled = resolve));
  const stderr = new PassThrough();
  stderr.end();
  const handle = {
    events: {
      [Symbol.asyncIterator]() {
        let index = 0;
        return {
          async next() {
            if (index < events.length) return { done: false, value: events[index++] };
            await killed;
            return { done: true, value: undefined };
          },
        };
      },
    } as AsyncIterable<any>,
    exit: killed.then(() => ({ code: null, signal: 'SIGKILL' as NodeJS.Signals })),
    kill: vi.fn(() => markKilled()),
    pid: 4242,
    stderr,
  };
  return handle;
};

const event = (type: string, data: any) => ({
  data,
  operationId: 'op-1',
  stepIndex: 0,
  timestamp: 0,
  type,
});

describe('hetero exec silence watchdog', () => {
  beforeEach(() => {
    vi.stubEnv(HETERO_EXEC_INHERIT_PROCESS_GROUP_ENV, '1');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__${code}`);
    }) as any);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mockResolveHeteroSpawnCommand.mockImplementation(
      async (agentType: LocalHeterogeneousAgentType) => ({
        command: HETEROGENEOUS_AGENT_CONFIGS.find(({ type }) => type === agentType)!.defaultCommand,
      }),
    );
    mockHeteroFinishMutate.mockResolvedValue({ ack: true });
    mockGetTrpcClient.mockResolvedValue({
      aiAgent: {
        heteroFinish: { mutate: mockHeteroFinishMutate },
        heteroIngest: { mutate: vi.fn().mockResolvedValue({ ack: true }) },
        waitInterventionResponse: { query: vi.fn(() => new Promise(() => {})) },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    mockForceKillProcessTree.mockReset();
    mockHeteroFinishMutate.mockReset();
    mockSpawnAgent.mockReset();
  });

  const run = async (handle: ReturnType<typeof hangingHandle>, advance: () => Promise<void>) => {
    mockSpawnAgent.mockResolvedValue(handle);
    const program = new Command();
    program.exitOverride();
    registerHeteroCommand(program);
    const done = program
      .parseAsync(
        [
          'hetero',
          'exec',
          '--type',
          'claude-code',
          '--prompt',
          'hi',
          '--topic',
          'topic-1',
          '--operation-id',
          'op-1',
        ],
        { from: 'user' },
      )
      .catch((error: Error) => {
        if (!error.message.startsWith('__exit__')) throw error;
      });
    await vi.waitFor(() => expect(mockSpawnAgent).toHaveBeenCalled());
    await advance();
    await done;
  };

  it('kills a Bash call hung past its timeout and reports a distinct failure', async () => {
    // Incident shape: `"timeout":300000` Bash started, no tool result for an hour.
    const handle = hangingHandle([
      event('tool_start', {
        toolCalling: {
          apiName: 'Bash',
          arguments: JSON.stringify({ command: 'loop', timeout: 5 * MIN }),
          id: 'toolu_1',
          identifier: 'claude-code',
        },
      }),
    ]);

    await run(handle, async () => {
      await vi.advanceTimersByTimeAsync(14 * MIN);
      expect(handle.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1 * MIN);
    });

    expect(mockForceKillProcessTree).toHaveBeenCalledWith(4242);
    expect(handle.kill).toHaveBeenCalledWith('SIGKILL');
    expect(mockHeteroFinishMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          message: expect.stringContaining('tool `Bash` had been running for 15m, past its 5m'),
          type: 'HeteroAgentSilenceTimeout',
        },
        result: 'error',
      }),
    );
  });

  it('kills a process that never produces output', async () => {
    const handle = hangingHandle([]);

    await run(handle, () => vi.advanceTimersByTimeAsync(3 * MIN));

    expect(handle.kill).toHaveBeenCalledWith('SIGKILL');
    expect(mockHeteroFinishMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: expect.stringContaining('never started a session'),
          type: 'HeteroAgentSilenceTimeout',
        }),
        result: 'error',
      }),
    );
  });

  it('stays off when disabled', async () => {
    vi.stubEnv('LOBE_HETERO_WATCHDOG_DISABLED', '1');
    const handle = hangingHandle([]);

    await run(handle, async () => {
      await vi.advanceTimersByTimeAsync(120 * MIN);
      expect(handle.kill).not.toHaveBeenCalled();
      // End the run the way a user stop would.
      handle.kill();
    });

    expect(mockForceKillProcessTree).not.toHaveBeenCalled();
  });
});
