import { PassThrough } from 'node:stream';

import type { LocalHeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import { HETEROGENEOUS_AGENT_CONFIGS } from '@lobechat/heterogeneous-agents';
import type * as HeteroAskUser from '@lobechat/heterogeneous-agents/askUser';
import { HETERO_EXEC_INHERIT_PROCESS_GROUP_ENV } from '@lobechat/heterogeneous-agents/protocol';
import type * as HeteroSpawn from '@lobechat/heterogeneous-agents/spawn';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerHeteroCommand } from './hetero';

const { bridgeOptions, mockResolveHeteroSpawnCommand, mockSpawnAgent } = vi.hoisted(() => ({
  bridgeOptions: [] as unknown[],
  mockResolveHeteroSpawnCommand: vi.fn(),
  mockSpawnAgent: vi.fn(),
}));
const { mockGetTrpcClient, mockHeteroFinishMutate, mockHeteroIngestMutate } = vi.hoisted(() => ({
  mockGetTrpcClient: vi.fn(),
  mockHeteroFinishMutate: vi.fn(),
  mockHeteroIngestMutate: vi.fn(),
}));

vi.mock('@lobechat/heterogeneous-agents/spawn', async (importOriginal) => ({
  ...(await importOriginal<typeof HeteroSpawn>()),
  spawnAgent: mockSpawnAgent,
}));

// Record the options each bridge is built with; the bridge keeps them private.
vi.mock('@lobechat/heterogeneous-agents/askUser', async (importOriginal) => {
  const actual = await importOriginal<typeof HeteroAskUser>();
  class RecordingAskUserBridge extends actual.AskUserBridge {
    constructor(...args: ConstructorParameters<typeof actual.AskUserBridge>) {
      super(...args);
      bridgeOptions.push(args[1]);
    }
  }
  return { ...actual, AskUserBridge: RecordingAskUserBridge };
});

vi.mock('@lobechat/heterogeneous-agents/resolveCliCommand', () => ({
  resolveHeteroSpawnCommand: mockResolveHeteroSpawnCommand,
}));

vi.mock('../api/client', () => ({
  getTrpcClient: mockGetTrpcClient,
}));

vi.mock('../utils/OperationTokenRenewal', () => ({
  createOperationTokenRenewal: () => ({ active: true, stop: vi.fn() }),
}));

const createFakeHandle = () => {
  const stderr = new PassThrough();
  setImmediate(() => stderr.end());

  return Promise.resolve({
    events: {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: true as const, value: undefined }),
      }),
    },
    exit: Promise.resolve({ code: 0, signal: null }),
    kill: vi.fn(),
    pid: 12_345,
    stderr,
  });
};

const runCmd = async (argv: string[]) => {
  const program = new Command();
  program.exitOverride();
  registerHeteroCommand(program);
  try {
    await program.parseAsync(['hetero', 'exec', ...argv], { from: 'user' });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('__exit__')) return;
    throw err;
  }
};

const serverIngestArgs = (operationId: string) => [
  '--topic',
  'topic-1',
  '--operation-id',
  operationId,
  '--render',
  'none',
];

describe('hetero exec ACP agents', () => {
  beforeEach(() => {
    vi.stubEnv(HETERO_EXEC_INHERIT_PROCESS_GROUP_ENV, '');
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__${code}`);
    }) as any);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    bridgeOptions.length = 0;
    mockResolveHeteroSpawnCommand.mockReset();
    mockResolveHeteroSpawnCommand.mockImplementation(
      async (agentType: LocalHeterogeneousAgentType, command?: string) => ({
        command:
          command ??
          HETEROGENEOUS_AGENT_CONFIGS.find(({ type }) => type === agentType)!.defaultCommand,
      }),
    );
    mockSpawnAgent.mockReset();
    mockSpawnAgent.mockImplementation(createFakeHandle);
    mockHeteroIngestMutate.mockReset().mockResolvedValue({ ack: true });
    mockHeteroFinishMutate.mockReset().mockResolvedValue({ ack: true });
    mockGetTrpcClient.mockReset().mockResolvedValue({
      aiAgent: {
        heteroFinish: { mutate: mockHeteroFinishMutate },
        heteroIngest: { mutate: mockHeteroIngestMutate },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('runs GitHub Copilot over ACP with the model switched after the handshake', async () => {
    await runCmd([
      '--type',
      'copilot',
      '--prompt',
      'do thing',
      '--resume',
      'copilot-session',
      '--model',
      'gpt-5.4',
      '--effort',
      'high',
      '--agent-arg=--add-dir',
      '--agent-arg=/repo',
    ]);

    expect(mockResolveHeteroSpawnCommand).toHaveBeenCalledWith('copilot', undefined);
    expect(mockSpawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'copilot',
        askUserBridge: undefined,
        command: 'copilot',
        extraArgs: ['--add-dir', '/repo'],
        initialModel: 'gpt-5.4',
        prompt: 'do thing',
        resumeSessionId: 'copilot-session',
      }),
    );
    // A standalone run has nobody to ask, so it must not opt into allow-all.
    expect(mockSpawnAgent.mock.calls[0][0].allowAll).toBeUndefined();
  });

  it('routes server-ingest Copilot permission requests to the Claude Code card', async () => {
    await runCmd(['--type', 'copilot', '--prompt', 'do thing', ...serverIngestArgs('op-copilot')]);

    expect(mockSpawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'copilot',
        askUserBridge: expect.objectContaining({ operationId: 'op-copilot' }),
      }),
    );
    expect(mockSpawnAgent.mock.calls[0][0].allowAll).toBeUndefined();
    expect(bridgeOptions).toEqual([{ identifier: 'claude-code', provider: 'copilot' }]);
  });

  it.each([
    ['cursor', 'claude-code'],
    ['devin', 'devin'],
    ['droid', 'droid'],
  ] as const)(
    'keeps the %s server-ingest intervention bridge identity',
    async (type, identifier) => {
      await runCmd(['--type', type, '--prompt', 'do thing', ...serverIngestArgs(`op-${type}`)]);

      expect(mockSpawnAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: type,
          askUserBridge: expect.objectContaining({ pending: expect.any(Function) }),
        }),
      );
      expect(bridgeOptions).toEqual([{ identifier, provider: type }]);
    },
  );

  it('keeps Devin server-ingest runs in bypass permission mode', async () => {
    await runCmd(['--type', 'devin', '--prompt', 'do thing', ...serverIngestArgs('op-devin')]);

    expect(mockSpawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'devin', permissionMode: 'bypass' }),
    );
  });

  it('runs Cursor with model, resume, and native args', async () => {
    await runCmd([
      '--type',
      'cursor',
      '--prompt',
      'do thing',
      '--resume',
      'cursor-session',
      '--model',
      'sonnet-4-thinking',
      '--agent-arg=--mode',
      '--agent-arg=plan',
    ]);

    expect(mockResolveHeteroSpawnCommand).toHaveBeenCalledWith('cursor', undefined);
    expect(mockSpawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'cursor',
        askUserBridge: undefined,
        command: 'agent',
        extraArgs: ['--mode', 'plan', '--model', 'sonnet-4-thinking'],
        resumeSessionId: 'cursor-session',
      }),
    );
  });

  it('runs Devin through ACP with its selected model and native arguments', async () => {
    await runCmd([
      '--type',
      'devin',
      '--prompt',
      'do thing',
      '--model',
      'claude-sonnet-4-6-thinking',
      '--agent-arg=--agent-type',
      '--agent-arg=coding',
    ]);

    expect(mockResolveHeteroSpawnCommand).toHaveBeenCalledWith('devin', undefined);
    expect(mockSpawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'devin',
        command: 'devin',
        extraArgs: ['--agent-type', 'coding', '--model', 'claude-sonnet-4-6-thinking'],
        initialModel: 'claude-sonnet-4-6-thinking',
        permissionMode: 'bypass',
        prompt: 'do thing',
      }),
    );
  });

  it('runs TRAE Enterprise with ACP model selection and only native provider arguments', async () => {
    mockResolveHeteroSpawnCommand.mockResolvedValue({ command: 'traecli' });

    await runCmd([
      '--type',
      'trae',
      '--prompt',
      'do thing',
      '--model',
      'gpt-5.4',
      '--agent-arg=--feature',
      '--agent-arg=test',
    ]);

    expect(mockResolveHeteroSpawnCommand).toHaveBeenCalledWith('trae', undefined);
    expect(mockSpawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'trae',
        command: 'traecli',
        extraArgs: ['--feature', 'test'],
        initialModel: 'gpt-5.4',
        prompt: 'do thing',
      }),
    );
  });

  it('runs Factory Droid with ACP model selection and safe native provider arguments', async () => {
    await runCmd([
      '--type',
      'droid',
      '--prompt',
      'do thing',
      '--model',
      'gpt-5.4',
      '--agent-arg=--tag',
      '--agent-arg=lobe',
    ]);

    expect(mockResolveHeteroSpawnCommand).toHaveBeenCalledWith('droid', undefined);
    expect(mockSpawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'droid',
        askUserBridge: undefined,
        command: 'droid',
        extraArgs: ['--tag', 'lobe'],
        initialModel: 'gpt-5.4',
        prompt: 'do thing',
      }),
    );
  });
});
