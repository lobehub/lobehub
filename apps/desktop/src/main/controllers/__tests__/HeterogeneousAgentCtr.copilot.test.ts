import type * as fsModule from 'node:fs';
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import type * as spawnModule from '@lobechat/heterogeneous-agents/spawn';
import { AcpRpcResponseError } from '@lobechat/heterogeneous-agents/spawn';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import HeterogeneousAgentCtr from '../HeterogeneousAgentImpl';

const FAKE_DESKTOP_PATH = '/Users/fake/Desktop';

const { copilot, mockGetAllWindows, serverDefault } = vi.hoisted(() => ({
  copilot: {
    close: vi.fn(),
    construct: vi.fn(),
    interrupt: vi.fn(),
    run: vi.fn(),
  },
  mockGetAllWindows: vi.fn<() => any[]>(() => []),
  serverDefault: {
    begin: vi.fn(),
    describe: vi.fn(),
    endpoint: vi.fn(),
    settle: vi.fn(),
  },
}));

vi.mock('@/modules/heterogeneousAgent/providerBindingPort', () => ({
  beginServerDefaultOperation: serverDefault.begin,
  describeServerDefaultModel: serverDefault.describe,
  getServerDefaultEndpoint: serverDefault.endpoint,
  settleServerDefaultOperation: serverDefault.settle,
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => mockGetAllWindows() },
  app: {
    getAppPath: vi.fn(() => '/fake/appPath'),
    getPath: vi.fn((name: string) => (name === 'desktop' ? FAKE_DESKTOP_PATH : `/fake/${name}`)),
    getVersion: vi.fn(() => '1.0.0-test'),
    isPackaged: false,
    on: vi.fn(),
    quit: vi.fn(),
  },
  ipcMain: { handle: vi.fn() },
}));

vi.mock('@lobechat/heterogeneous-agents/spawn', async (importOriginal) => {
  const actual = await importOriginal<typeof spawnModule>();

  /** Stands in for `copilot --acp`; a test drives a run through `copilot.run`. */
  class MockCopilotAcpSession {
    constructor(private readonly options: spawnModule.CopilotAcpSessionOptions) {
      // Mirror the real constructor, which rejects unsafe args before spawning.
      actual.buildCopilotAcpArgs(options.args);
      copilot.construct(options);
    }

    close() {
      copilot.close();
    }

    interrupt() {
      copilot.interrupt();
    }

    async run() {
      return copilot.run(this.options);
    }
  }

  return { ...actual, CopilotAcpSession: MockCopilotAcpSession };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fsModule>();
  return { ...actual, existsSync: vi.fn(() => true), statSync: vi.fn() };
});

vi.mock('@/modules/binaries', () => ({
  detectHeterogeneousCliCommand: vi.fn(async () => ({
    available: true,
    path: '/usr/local/bin/copilot',
  })),
}));

/** A finished Copilot turn: runtime status, native session, model, then the terminal event. */
const completeTurn = async (options: spawnModule.CopilotAcpSessionOptions) => {
  const now = Date.now();
  options.onRuntimeStatus({
    activeTasks: [],
    lastEventAt: now,
    operationId: options.operationId,
    sessionId: options.sessionId,
    state: 'running',
    transport: 'copilot-acp',
  });
  options.onSessionId('copilot-session-1');
  options.onModel?.('gpt-5.4');
  await options.onEvents([
    {
      data: { stopReason: 'end_turn' },
      operationId: options.operationId,
      stepIndex: 0,
      timestamp: now,
      type: 'agent_runtime_end',
    },
  ]);
};

describe('HeterogeneousAgentCtr GitHub Copilot ACP', () => {
  let appStoragePath: string;
  let send: ReturnType<typeof vi.fn>;

  const createCtr = () =>
    new HeterogeneousAgentCtr({ appStoragePath, storeManager: { get: vi.fn() } } as unknown as App);

  beforeEach(async () => {
    vi.clearAllMocks();
    copilot.run.mockReset();
    copilot.run.mockImplementation(completeTurn);
    send = vi.fn();
    mockGetAllWindows.mockReturnValue([{ isDestroyed: () => false, webContents: { send } }]);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);
    appStoragePath = await mkdtemp(path.join(os.tmpdir(), 'lobehub-copilot-acp-'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(appStoragePath, { force: true, recursive: true });
  });

  it('routes Copilot through ACP and keeps its native session and model', async () => {
    const ctr = createCtr();
    const { sessionId } = await ctr.startSession({
      agentType: 'copilot',
      args: ['--add-dir', '/repo'],
      command: 'copilot',
      initialModel: 'gpt-5.4',
      resumeSessionId: 'copilot-session-old',
    });

    await ctr.sendPrompt({
      operationId: 'op-copilot',
      prompt: 'inspect this repo',
      sessionId,
      systemContext: 'selected workspace context',
    });

    expect(copilot.construct).toHaveBeenCalledOnce();
    expect(copilot.construct).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['--add-dir', '/repo'],
        askUserBridge: expect.objectContaining({ operationId: 'op-copilot' }),
        clientVersion: '1.0.0-test',
        commandPath: 'copilot',
        cwd: FAKE_DESKTOP_PATH,
        initialModel: 'gpt-5.4',
        operationId: 'op-copilot',
        prompt: [
          { text: 'selected workspace context', type: 'text' },
          { text: 'inspect this repo', type: 'text' },
        ],
        resumeSessionId: 'copilot-session-old',
        sessionId,
      }),
    );
    // Desktop runs are interactive: permission requests go to the user, never allow-all.
    expect(copilot.construct.mock.calls[0][0].allowAll).toBeUndefined();
    await expect(ctr.getSessionInfo({ sessionId })).resolves.toEqual({
      agentSessionId: 'copilot-session-1',
    });
    expect(send).toHaveBeenCalledWith(
      'heteroAgentRuntimeStatus',
      expect.objectContaining({ state: 'running', transport: 'copilot-acp' }),
    );
    expect(send).toHaveBeenCalledWith('heteroAgentEvent', {
      event: expect.objectContaining({ type: 'agent_runtime_end' }),
      sessionId,
    });
    expect(send).toHaveBeenCalledWith('heteroAgentSessionComplete', { sessionId });
  });

  it('asks the user before a Copilot tool runs, through the Claude Code permission card', async () => {
    let receivedAnswer: unknown;
    copilot.run.mockImplementation(async (options: spawnModule.CopilotAcpSessionOptions) => {
      receivedAnswer = await options.askUserBridge!.pending({
        arguments: {
          questions: [
            {
              header: 'Permission required',
              multiSelect: false,
              options: [
                { id: 'allow_once', label: 'Allow once' },
                { id: 'reject_once', label: 'Reject' },
              ],
              question: 'Run requested shell command\n\nnpm test',
            },
          ],
        },
        interactionKind: 'permission',
        toolCallId: 'copilot-permission-0-call_1',
      });
    });
    const ctr = createCtr();
    const { sessionId } = await ctr.startSession({ agentType: 'copilot', command: 'copilot' });
    const run = ctr.sendPrompt({ operationId: 'op-copilot-ask', prompt: 'run tests', sessionId });

    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith('heteroAgentEvent', {
        event: expect.objectContaining({
          data: expect.objectContaining({
            identifier: 'claude-code',
            interactionKind: 'permission',
            provider: 'copilot',
            toolCallId: 'copilot-permission-0-call_1',
          }),
          type: 'agent_intervention_request',
        }),
        sessionId,
      }),
    );
    await ctr.submitIntervention({
      operationId: 'op-copilot-ask',
      result: { 'Run requested shell command\n\nnpm test': 'allow_once' },
      toolCallId: 'copilot-permission-0-call_1',
    });
    await run;

    expect(receivedAnswer).toEqual({
      result: { 'Run requested shell command\n\nnpm test': 'allow_once' },
    });
  });

  it('classifies a missing resumed Copilot session so the next turn starts fresh', async () => {
    const missingSessionError = new AcpRpcResponseError('session/load', {
      code: -32_002,
      message: 'Session copilot-missing not found',
    });
    copilot.run.mockImplementation(async (options: spawnModule.CopilotAcpSessionOptions) => {
      await options.onStderr('Copilot ACP diagnostic\n');
      throw missingSessionError;
    });
    const ctr = createCtr();
    const { sessionId } = await ctr.startSession({
      agentType: 'copilot',
      command: 'copilot',
      cwd: '/Users/fake/projects/repo',
      resumeSessionId: 'copilot-missing',
    });

    await expect(
      ctr.sendPrompt({ operationId: 'op-copilot-resume', prompt: 'continue', sessionId }),
    ).rejects.toThrow(
      'The saved GitHub Copilot session could not be found, so a new conversation will start.',
    );
    expect(send).toHaveBeenCalledWith('heteroAgentSessionError', {
      error: {
        agentType: 'copilot',
        code: HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound,
        command: 'copilot',
        details: { code: -32_002, data: undefined },
        message:
          'The saved GitHub Copilot session could not be found, so a new conversation will start.',
        resumeSessionId: 'copilot-missing',
        stderr: missingSessionError.message,
        workingDirectory: '/Users/fake/projects/repo',
      },
      sessionId,
    });
    expect(send).not.toHaveBeenCalledWith('heteroAgentSessionComplete', { sessionId });
  });

  it('surfaces an ordinary Copilot failure with its stderr instead of a resume fallback', async () => {
    copilot.run.mockImplementation(async (options: spawnModule.CopilotAcpSessionOptions) => {
      await options.onStderr('Error: model "gpt-x" is not available\n');
      throw new Error('session/prompt failed');
    });
    const ctr = createCtr();
    const { sessionId } = await ctr.startSession({
      agentType: 'copilot',
      command: 'copilot',
      resumeSessionId: 'copilot-session-old',
    });

    await expect(
      ctr.sendPrompt({ operationId: 'op-copilot-fail', prompt: 'go', sessionId }),
    ).rejects.toThrow('session/prompt failed\nError: model "gpt-x" is not available');
    expect(send).not.toHaveBeenCalledWith(
      'heteroAgentSessionError',
      expect.objectContaining({
        error: expect.objectContaining({
          code: HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound,
        }),
      }),
    );
  });

  it.each([
    ['cancelSession', copilot.interrupt],
    ['stopSession', copilot.close],
  ] as const)('%s delegates to the active Copilot ACP session', async (action, expectedMock) => {
    let finishRun!: () => void;
    copilot.run.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRun = resolve;
        }),
    );
    const ctr = createCtr();
    const { sessionId } = await ctr.startSession({ agentType: 'copilot', command: 'copilot' });
    const run = ctr.sendPrompt({ operationId: 'op-copilot-stop', prompt: 'work', sessionId });
    await vi.waitFor(() => expect(copilot.construct).toHaveBeenCalledOnce());

    await ctr[action]({ sessionId });

    expect(expectedMock).toHaveBeenCalledOnce();
    finishRun();
    await run;
    expect(send).toHaveBeenCalledWith('heteroAgentSessionComplete', { sessionId });
  });

  it('refuses arguments that would bypass Copilot permission prompts before launching', async () => {
    const ctr = createCtr();
    const { sessionId } = await ctr.startSession({
      agentType: 'copilot',
      args: ['--allow-all-tools'],
      command: 'copilot',
    });

    await expect(
      ctr.sendPrompt({ operationId: 'op-copilot-unsafe', prompt: 'go', sessionId }),
    ).rejects.toThrow('GitHub Copilot ACP does not support CLI argument: --allow-all-tools');
    expect(copilot.construct).not.toHaveBeenCalled();
  });

  it('routes a server-default model to the LobeHub relay instead of GitHub', async () => {
    // A user BYOK setup in the app's environment must not outrank the binding.
    vi.stubEnv('COPILOT_PROVIDER_BEARER_TOKEN', 'user-byok-token');
    vi.stubEnv('COPILOT_PROVIDER_WIRE_MODEL', 'gpt-5.4');
    serverDefault.begin.mockResolvedValue({ token: 'operation-token' });
    serverDefault.describe.mockResolvedValue({
      abilities: { reasoning: true, vision: true },
      maxOutput: 64_000,
      model: 'claude-sonnet-4-6',
      nativeResponses: false,
    });
    serverDefault.endpoint.mockResolvedValue('https://lobehub.test');
    serverDefault.settle.mockResolvedValue({ success: true });
    const ctr = createCtr();
    const { sessionId } = await ctr.startSession({
      agentType: 'copilot',
      args: ['--model', 'gpt-5.4', '--add-dir', '/repo'],
      command: 'copilot',
      env: { COPILOT_PROVIDER_TYPE: 'openai' },
      providerBinding: {
        apiConfig: { model: 'claude-sonnet-4-6', source: 'server-default' },
        kind: 'server-default',
      },
    });

    await ctr.sendPrompt({
      operationId: 'op-copilot-server',
      prompt: 'go',
      sessionId,
      topicId: 'topic-1',
    });

    expect(serverDefault.describe).toHaveBeenCalledWith(expect.any(Object), {
      agentType: 'copilot',
      model: 'claude-sonnet-4-6',
    });
    const options = copilot.construct.mock.calls[0][0];
    expect(options.args).toEqual(['--add-dir', '/repo']);
    expect(options.initialModel).toBe('lobehub/claude-sonnet-4-6');
    expect(options.env).toMatchObject({
      COPILOT_MODEL: 'lobehub/claude-sonnet-4-6',
      COPILOT_OFFLINE: 'true',
      COPILOT_PROVIDER_API_KEY: 'operation-token',
      COPILOT_PROVIDER_BASE_URL: 'https://lobehub.test/api/v1/anthropic',
      COPILOT_PROVIDER_MAX_OUTPUT_TOKENS: '64000',
      COPILOT_PROVIDER_TYPE: 'anthropic',
    });
    expect(options.env.COPILOT_PROVIDER_BEARER_TOKEN).toBeUndefined();
    expect(options.env.COPILOT_PROVIDER_WIRE_MODEL).toBeUndefined();
    expect(serverDefault.settle).toHaveBeenCalledWith(expect.any(Object), {
      cancelled: false,
      operationId: 'op-copilot-server',
      result: 'done',
    });
  });
});
