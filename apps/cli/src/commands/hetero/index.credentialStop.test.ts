import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { AGENT_CREDENTIAL_RUN_DIR_ENV } from '@lobechat/device-control/agent-credentials';
import { HETERO_EXEC_INHERIT_PROCESS_GROUP_ENV } from '@lobechat/heterogeneous-agents/protocol';
import type * as HeteroSpawn from '@lobechat/heterogeneous-agents/spawn';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerHeteroCommand } from './index';

const { mockCreateCodexAgentHandle, mockHeteroFinishMutate, mockSpawnAgent } = vi.hoisted(() => ({
  mockCreateCodexAgentHandle: vi.fn(),
  mockHeteroFinishMutate: vi.fn(),
  mockSpawnAgent: vi.fn(),
}));

vi.mock('@lobechat/heterogeneous-agents/spawn', async (importOriginal) => ({
  ...(await importOriginal<typeof HeteroSpawn>()),
  createCodexAgentHandle: mockCreateCodexAgentHandle,
  spawnAgent: mockSpawnAgent,
}));
vi.mock('@lobechat/heterogeneous-agents/resolveCliCommand', () => ({
  resolveHeteroSpawnCommand: async () => ({ command: 'codex' }),
}));
vi.mock('../../api/client', () => ({
  getTrpcClient: async () => ({
    aiAgent: {
      heteroFinish: { mutate: mockHeteroFinishMutate },
      heteroIngest: { mutate: async () => ({ ack: true }) },
    },
  }),
}));
vi.mock('../../utils/OperationTokenRenewal', () => ({
  createOperationTokenRenewal: () => ({ active: true, stop: () => {} }),
}));
vi.mock('../../utils/traceStore', () => ({
  createLocalTraceStore: () => ({ write: async () => {} }),
}));

/** A Codex agent that keeps running until it is killed. */
const longRunningAgent = () => {
  let markKilled!: () => void;
  const killed = new Promise<void>((resolve) => {
    markKilled = resolve;
  });
  const stderr = new PassThrough();
  stderr.end();
  const kill = vi.fn(() => markKilled());
  const handle = {
    events: {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          await killed;
          return { done: true, value: undefined };
        },
      }),
    } as AsyncIterable<any>,
    exit: killed.then(() => ({ code: null, signal: 'SIGTERM' as NodeJS.Signals })),
    kill,
    pid: 12_345,
    stderr,
  };
  return { handle, kill };
};

const runExec = (...extra: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerHeteroCommand(program);
  return program
    .parseAsync(
      [
        'hetero',
        'exec',
        '--type',
        'codex',
        '--prompt',
        'hi',
        '--topic',
        'topic-1',
        '--operation-id',
        'op-1',
        ...extra,
      ],
      { from: 'user' },
    )
    .catch((error: Error) => error.message);
};

describe('hetero exec on an installed credential that gets replaced', () => {
  let runDir: string;

  beforeEach(async () => {
    runDir = path.join(await mkdtemp(path.join(tmpdir(), 'hetero-cred-stop-')), 'runs');
    // The desktop / connected-device dispatch: an inherited wrapper group, so
    // no external signal reaches the agent and the wrapper must stop it.
    vi.stubEnv(HETERO_EXEC_INHERIT_PROCESS_GROUP_ENV, '1');
    vi.stubEnv(AGENT_CREDENTIAL_RUN_DIR_ENV, runDir);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__${code}`);
    }) as any);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    mockHeteroFinishMutate.mockReset();
    mockHeteroFinishMutate.mockResolvedValue({ ack: true });
    mockSpawnAgent.mockReset();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(path.dirname(runDir), { force: true, recursive: true });
  });

  it('stops the agent and fails the run with the replacement reason', async () => {
    const agent = longRunningAgent();
    mockSpawnAgent.mockImplementation(async () => {
      // The lease is held before the agent starts, so a replacement sees it.
      expect(await readdir(runDir)).toEqual([`${process.pid}.json`]);
      await writeFile(path.join(runDir, `${process.pid}.stop`), 'Codex account replaced');
      return agent.handle;
    });

    const exit = await runExec();

    expect(agent.kill).toHaveBeenCalledWith('SIGTERM');
    // Not `cancelled`: nobody stopped this run from LobeHub, and the user must
    // learn why it ended.
    expect(mockHeteroFinishMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: 'Codex account replaced' }),
        result: 'error',
      }),
    );
    expect(exit).toBe('__exit__143');
    // Released once the agent exited, so the replacement stops waiting.
    expect(await readdir(runDir)).toEqual([]);
  }, 10_000);

  it('refuses to start the agent when the run cannot be leased', async () => {
    // A file where the lease directory belongs.
    await writeFile(runDir, '');
    const exit = await runExec();

    expect(exit).toBe('__exit__1');
    expect(mockSpawnAgent).not.toHaveBeenCalled();
    expect(mockHeteroFinishMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: expect.stringContaining('Could not register') }),
        result: 'error',
      }),
    );
  });

  it('leases the detached Codex app-server group so a forced stop can kill it', async () => {
    const agent = longRunningAgent();
    const leasedGroups = async () =>
      JSON.parse(await readFile(path.join(runDir, `${process.pid}.json`), 'utf8')).processGroups;
    let groupsWhileRunning: unknown;
    mockCreateCodexAgentHandle.mockImplementation(async (options) => {
      options.onProcessGroupChange(54_321, true);
      groupsWhileRunning = await leasedGroups();
      await writeFile(path.join(runDir, `${process.pid}.stop`), 'Codex account replaced');
      return agent.handle;
    });

    const exit = await runExec('--codex-app-server');

    expect(mockSpawnAgent).not.toHaveBeenCalled();
    expect(groupsWhileRunning).toEqual([54_321]);
    expect(agent.kill).toHaveBeenCalledWith('SIGTERM');
    expect(exit).toBe('__exit__143');
    expect(await readdir(runDir)).toEqual([]);
  }, 10_000);
});
