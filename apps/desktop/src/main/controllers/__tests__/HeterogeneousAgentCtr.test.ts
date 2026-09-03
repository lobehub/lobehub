import { EventEmitter } from 'node:events';
import { existsSync, statSync } from 'node:fs';
import { access, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import type { CodexQuotaSnapshot } from '@lobechat/electron-client-ipc';
import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import { AcpRpcResponseError } from '@lobechat/heterogeneous-agents/spawn';
// `electron` is mocked below; this binding is the mock object so tests can
// flip `isPackaged` to exercise the packaged-build tracing gate.
import { app as electronAppMock } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HeterogeneousAgentCtr, { redactPromptArgs } from '../HeterogeneousAgentImpl';

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => 'linux') };
});

const platformMock = vi.mocked(os.platform);

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, existsSync: vi.fn(() => true), statSync: vi.fn() };
});

// Working-directory checks go through `statSync`; treat every path as an
// existing directory unless a test marks one as missing.
const asDirectory = { isDirectory: () => true } as ReturnType<typeof statSync>;
const mockMissingDir = (missing: string) =>
  vi
    .mocked(statSync)
    .mockImplementation((candidate) => (candidate === missing ? undefined : asDirectory) as never);

const FAKE_DESKTOP_PATH = '/Users/fake/Desktop';

describe('redactPromptArgs', () => {
  it('redacts separated and inline Kimi prompt values without changing unrelated arguments', () => {
    expect(
      redactPromptArgs(
        [
          '--prompt',
          'private',
          '--model',
          'x',
          '-p',
          'short-private',
          '-p=inline',
          '--prompt=other',
        ],
        'kimi-code',
      ),
    ).toEqual([
      '--prompt',
      '[REDACTED]',
      '--model',
      'x',
      '-p',
      '[REDACTED]',
      '-p=[REDACTED]',
      '--prompt=[REDACTED]',
    ]);
  });

  it.each(['claude-code', 'qoder'] as const)(
    'keeps the %s mode flag and its following input-format argument intact',
    (agentType) => {
      expect(
        redactPromptArgs(['-p', '--input-format', 'stream-json', '--prompt=private'], agentType),
      ).toEqual(['-p', '--input-format', 'stream-json', '--prompt=[REDACTED]']);
    },
  );
});

const { mockGetAllWindows } = vi.hoisted(() => ({
  mockGetAllWindows: vi.fn<() => any[]>(() => []),
}));

const { loggerInfoMock } = vi.hoisted(() => ({
  loggerInfoMock: vi.fn(),
}));

const {
  beginServerDefaultOperationMock,
  getProviderBindingRuntimeMock,
  getServerDefaultEndpointMock,
  settleServerDefaultOperationMock,
} = vi.hoisted(() => ({
  beginServerDefaultOperationMock: vi.fn(),
  getProviderBindingRuntimeMock: vi.fn(),
  getServerDefaultEndpointMock: vi.fn(),
  settleServerDefaultOperationMock: vi.fn(),
}));

vi.mock('@/modules/heterogeneousAgent/providerBindingPort', () => ({
  beginServerDefaultOperation: beginServerDefaultOperationMock,
  getProviderBindingRuntime: getProviderBindingRuntimeMock,
  getServerDefaultEndpoint: getServerDefaultEndpointMock,
  settleServerDefaultOperation: settleServerDefaultOperationMock,
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => mockGetAllWindows() },
  app: {
    getAppPath: vi.fn(() => '/fake/appPath'),
    getVersion: vi.fn(() => '1.0.0-test'),
    getPath: vi.fn((name: string) => (name === 'desktop' ? FAKE_DESKTOP_PATH : `/fake/${name}`)),
    isPackaged: false,
    on: vi.fn(),
  },
  ipcMain: { handle: vi.fn() },
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: loggerInfoMock,
    verbose: vi.fn(),
    warn: vi.fn(),
  }),
}));

const {
  claudeSdkSessionCloseMock,
  claudeSdkSessionConstructMock,
  codexAppServerCanReuse,
  codexAppServerClientCloseMock,
  codexAppServerClientConstructMock,
  codexAppServerCloseMock,
  codexAppServerConsumerCount,
  codexAppServerConstructMock,
  codexAppServerInterruptMock,
  codexAppServerRunMock,
  codexAppServerShouldFailAfterThread,
  codexAppServerShouldFailResume,
  codexAppServerShouldFallback,
  cursorAcpSessionCloseMock,
  cursorAcpSessionConstructMock,
  cursorAcpSessionInterruptMock,
  cursorAcpSessionRunMock,
  droidAcpSessionCloseMock,
  droidAcpSessionConstructMock,
  droidAcpSessionInterruptMock,
  droidAcpSessionRunMock,
  grokAcpSessionCloseMock,
  grokAcpSessionConstructMock,
  grokAcpSessionInterruptMock,
  grokAcpSessionRunMock,
  traeAcpSessionCloseMock,
  traeAcpSessionConstructMock,
  traeAcpSessionInterruptMock,
  traeAcpSessionRunMock,
} = vi.hoisted(() => ({
  claudeSdkSessionCloseMock: vi.fn(),
  claudeSdkSessionConstructMock: vi.fn(),
  codexAppServerCanReuse: { value: true },
  codexAppServerClientCloseMock: vi.fn(),
  codexAppServerClientConstructMock: vi.fn(),
  codexAppServerCloseMock: vi.fn(),
  codexAppServerConsumerCount: { value: 0 },
  codexAppServerConstructMock: vi.fn(),
  codexAppServerInterruptMock: vi.fn(),
  codexAppServerRunMock: vi.fn(),
  codexAppServerShouldFailAfterThread: { value: false },
  codexAppServerShouldFailResume: { value: false },
  codexAppServerShouldFallback: { value: false },
  cursorAcpSessionCloseMock: vi.fn(),
  cursorAcpSessionConstructMock: vi.fn(),
  cursorAcpSessionInterruptMock: vi.fn(),
  cursorAcpSessionRunMock: vi.fn(),
  droidAcpSessionCloseMock: vi.fn(),
  droidAcpSessionConstructMock: vi.fn(),
  droidAcpSessionInterruptMock: vi.fn(),
  droidAcpSessionRunMock: vi.fn(),
  grokAcpSessionCloseMock: vi.fn(),
  grokAcpSessionConstructMock: vi.fn(),
  grokAcpSessionInterruptMock: vi.fn(),
  grokAcpSessionRunMock: vi.fn(),
  traeAcpSessionCloseMock: vi.fn(),
  traeAcpSessionConstructMock: vi.fn(),
  traeAcpSessionInterruptMock: vi.fn(),
  traeAcpSessionRunMock: vi.fn(),
}));

vi.mock('@lobechat/heterogeneous-agents/spawn', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  class MockClaudeAgentSdkSession {
    constructor(private readonly options: any) {
      claudeSdkSessionConstructMock(options);
    }

    close() {
      claudeSdkSessionCloseMock();
    }

    async run() {
      const now = Date.now();
      this.options.onRuntimeStatus({
        activeTasks: [
          {
            lastEventAt: now,
            startedAt: now,
            taskId: 'task_1',
          },
        ],
        lastEventAt: now,
        operationId: this.options.operationId,
        sessionId: this.options.sessionId,
        staleDeadlineAt: now + 300_000,
        state: 'monitoring',
        transport: 'claude-sdk',
      });
      this.options.onSessionId('sess_sdk');
      await this.options.onEvents([
        {
          data: { reason: 'complete', transport: 'claude-sdk' },
          stepIndex: 0,
          timestamp: now,
          type: 'agent_runtime_end',
        },
      ]);
      this.options.onRuntimeStatus({
        activeTasks: [],
        lastEventAt: now,
        sessionId: this.options.sessionId,
        state: 'closed',
        transport: 'claude-sdk',
      });
    }
  }

  class MockCodexAppServerClient {
    constructor(options: any) {
      codexAppServerClientConstructMock(options);
    }

    canReuseFor() {
      return codexAppServerCanReuse.value;
    }

    get hasConsumers() {
      return codexAppServerConsumerCount.value > 0;
    }

    close() {
      codexAppServerClientCloseMock();
    }
  }

  class MockCodexThreadSession {
    canFallbackToExec = true;
    private closed = false;

    constructor(private readonly options: any) {
      codexAppServerConsumerCount.value += 1;
      codexAppServerConstructMock(options);
    }

    close() {
      if (!this.closed) {
        this.closed = true;
        codexAppServerConsumerCount.value -= 1;
      }
      codexAppServerCloseMock();
    }

    async interrupt() {
      return codexAppServerInterruptMock();
    }

    async run(runOptions: any) {
      codexAppServerRunMock(runOptions);
      if (codexAppServerShouldFailResume.value && this.options.initialThreadId) {
        this.canFallbackToExec = false;
        const error = new Error('Thread not found');
        error.name = 'CodexAppServerConnectionError';
        throw error;
      }
      if (codexAppServerShouldFallback.value) {
        const error = new Error('Method not found: initialize');
        error.name = 'CodexAppServerConnectionError';
        throw error;
      }

      const now = Date.now();
      this.canFallbackToExec = false;
      if (codexAppServerShouldFailAfterThread.value) {
        const error = new Error('Codex app-server disconnected');
        error.name = 'CodexAppServerConnectionError';
        throw error;
      }
      this.options.onRuntimeStatus({
        activeTasks: [],
        lastEventAt: now,
        operationId: runOptions.operationId,
        sessionId: this.options.sessionId,
        state: 'running',
        transport: 'codex-app-server',
      });
      this.options.onSessionId('thread_app_server');
      await this.options.onEvents([
        {
          data: { reason: 'complete', transport: 'codex-app-server' },
          operationId: runOptions.operationId,
          stepIndex: 0,
          timestamp: now,
          type: 'agent_runtime_end',
        },
      ]);
      this.options.onRuntimeStatus({
        activeTasks: [],
        lastEventAt: now,
        sessionId: this.options.sessionId,
        state: 'closed',
        transport: 'codex-app-server',
      });
    }
  }

  class MockGrokAcpSession {
    constructor(private readonly options: any) {
      grokAcpSessionConstructMock(options);
    }

    close() {
      grokAcpSessionCloseMock();
    }

    interrupt() {
      grokAcpSessionInterruptMock();
    }

    run() {
      return grokAcpSessionRunMock(this.options);
    }
  }

  class MockCursorAcpSession {
    constructor(private readonly options: any) {
      cursorAcpSessionConstructMock(options);
    }

    close() {
      cursorAcpSessionCloseMock();
    }

    interrupt() {
      cursorAcpSessionInterruptMock();
    }

    async run() {
      if (cursorAcpSessionRunMock.getMockImplementation()) {
        return cursorAcpSessionRunMock(this.options);
      }
      const now = Date.now();
      this.options.onRuntimeStatus({
        activeTasks: [],
        lastEventAt: now,
        operationId: this.options.operationId,
        sessionId: this.options.sessionId,
        state: 'running',
        transport: 'cursor-acp',
      });
      this.options.onSessionId('cursor-session-1');
      await this.options.onEvents([
        {
          data: { stopReason: 'end_turn' },
          operationId: this.options.operationId,
          stepIndex: 0,
          timestamp: now,
          type: 'agent_runtime_end',
        },
      ]);
      this.options.onRuntimeStatus({
        activeTasks: [],
        lastEventAt: now,
        operationId: this.options.operationId,
        sessionId: this.options.sessionId,
        state: 'closed',
        transport: 'cursor-acp',
      });
    }
  }

  class MockTraeAcpSession {
    constructor(private readonly options: any) {
      traeAcpSessionConstructMock(options);
    }

    close() {
      traeAcpSessionCloseMock();
    }

    async interrupt() {
      traeAcpSessionInterruptMock();
    }

    async run() {
      if (traeAcpSessionRunMock.getMockImplementation()) {
        return traeAcpSessionRunMock(this.options);
      }
      const now = Date.now();
      this.options.onRuntimeStatus({
        activeTasks: [],
        lastEventAt: now,
        operationId: this.options.operationId,
        sessionId: this.options.sessionId,
        state: 'running',
        transport: 'trae-acp',
      });
      this.options.onSessionId('trae_session_1');
      await this.options.onEvents([
        {
          data: { stopReason: 'end_turn' },
          operationId: this.options.operationId,
          stepIndex: 0,
          timestamp: now,
          type: 'agent_runtime_end',
        },
      ]);
      this.options.onRuntimeStatus({
        activeTasks: [],
        lastEventAt: now,
        operationId: this.options.operationId,
        sessionId: this.options.sessionId,
        state: 'closed',
        transport: 'trae-acp',
      });
    }
  }

  class MockDroidAcpSession {
    constructor(private readonly options: any) {
      droidAcpSessionConstructMock(options);
    }

    close() {
      droidAcpSessionCloseMock();
    }

    interrupt() {
      droidAcpSessionInterruptMock();
    }

    async run() {
      if (droidAcpSessionRunMock.getMockImplementation()) {
        return droidAcpSessionRunMock(this.options);
      }
      const now = Date.now();
      this.options.onRuntimeStatus({
        activeTasks: [],
        lastEventAt: now,
        operationId: this.options.operationId,
        sessionId: this.options.sessionId,
        state: 'running',
        transport: 'droid-acp',
      });
      this.options.onSessionId('droid_session_1');
      await this.options.onEvents([
        {
          data: { stopReason: 'end_turn' },
          operationId: this.options.operationId,
          stepIndex: 0,
          timestamp: now,
          type: 'agent_runtime_end',
        },
      ]);
    }
  }

  return {
    ...actual,
    ClaudeAgentSdkSession: MockClaudeAgentSdkSession,
    CodexAppServerClient: MockCodexAppServerClient,
    CodexThreadSession: MockCodexThreadSession,
    CursorAcpSession: MockCursorAcpSession,
    DroidAcpSession: MockDroidAcpSession,
    isCodexAppServerCompatibilityError: (error: Error) =>
      error.name === 'CodexAppServerConnectionError',
    GrokAcpSession: MockGrokAcpSession,
    TraeAcpSession: MockTraeAcpSession,
  };
});

const { consumeCodexRateLimitResetCreditMock, fetchCodexQuotaMock } = vi.hoisted(() => ({
  consumeCodexRateLimitResetCreditMock: vi.fn(),
  fetchCodexQuotaMock: vi.fn(),
}));

vi.mock('@/modules/heterogeneousAgent/codexQuota', () => ({
  consumeCodexRateLimitResetCredit: consumeCodexRateLimitResetCreditMock,
  fetchCodexQuota: fetchCodexQuotaMock,
}));

// Captures the most recent spawn() call so sendPrompt tests can assert on argv.
const spawnCalls: Array<{ args: string[]; command: string; options: any }> = [];
let nextFakeProc: any = null;
const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;

  return {
    ...actual,
    execFile: execFileMock,
    spawn: (command: string, args: string[], options: any) => {
      spawnCalls.push({ args, command, options });
      nextFakeProc?.__start?.();
      return nextFakeProc;
    },
  };
});

/**
 * Build a fake ChildProcess that immediately exits cleanly. Records every
 * stdin write on the returned `writes` array so tests can inspect the payload.
 */
const createFakeProc = ({
  exitCode = 0,
  stderrLines = [],
  stdoutLines = [],
}: {
  exitCode?: number;
  stderrLines?: string[];
  stdoutLines?: string[];
} = {}) => {
  const proc = new EventEmitter() as any;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const writes: string[] = [];
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = {
    end: vi.fn(),
    write: vi.fn((chunk: string, cb?: () => void) => {
      writes.push(chunk);
      cb?.();
      return true;
    }),
  };
  proc.kill = vi.fn();
  proc.killed = false;
  let started = false;
  proc.__start = () => {
    if (started) return;
    started = true;
    // Exit asynchronously so the Promise returned by sendPrompt resolves cleanly.
    setImmediate(() => {
      for (const line of stdoutLines) {
        stdout.write(line);
      }
      for (const line of stderrLines) {
        stderr.write(line);
      }
      stdout.end();
      stderr.end();
      proc.emit('exit', exitCode);
    });
  };
  return { proc, writes };
};

const getFlagValues = (args: string[], flag: string) =>
  args.flatMap((arg, index) => (arg === flag ? [args[index + 1]] : []));

describe('HeterogeneousAgentCtr', () => {
  let appStoragePath: string;
  let originalClaudeSdkLabEnv: string | undefined;
  let originalCodexAppServerLabEnv: string | undefined;

  beforeEach(async () => {
    originalClaudeSdkLabEnv = process.env.LOBE_CLAUDE_CODE_SDK;
    originalCodexAppServerLabEnv = process.env.LOBE_CODEX_APP_SERVER;
    appStoragePath = await mkdtemp(path.join(os.tmpdir(), 'lobehub-hetero-'));
    consumeCodexRateLimitResetCreditMock.mockReset();
    fetchCodexQuotaMock.mockReset();
    claudeSdkSessionCloseMock.mockReset();
    claudeSdkSessionConstructMock.mockReset();
    codexAppServerCanReuse.value = true;
    codexAppServerClientCloseMock.mockReset();
    codexAppServerClientConstructMock.mockReset();
    codexAppServerCloseMock.mockReset();
    codexAppServerConsumerCount.value = 0;
    codexAppServerConstructMock.mockReset();
    codexAppServerInterruptMock.mockReset();
    codexAppServerRunMock.mockReset();
    codexAppServerShouldFailAfterThread.value = false;
    codexAppServerShouldFailResume.value = false;
    codexAppServerShouldFallback.value = false;
    cursorAcpSessionCloseMock.mockReset();
    cursorAcpSessionConstructMock.mockReset();
    cursorAcpSessionInterruptMock.mockReset();
    cursorAcpSessionRunMock.mockReset();
    grokAcpSessionCloseMock.mockReset();
    grokAcpSessionConstructMock.mockReset();
    grokAcpSessionInterruptMock.mockReset();
    grokAcpSessionRunMock.mockReset();
    grokAcpSessionRunMock.mockImplementation(async (options) => {
      const now = Date.now();
      options.onRuntimeStatus({
        activeTasks: [],
        lastEventAt: now,
        operationId: options.operationId,
        sessionId: options.sessionId,
        state: 'running',
        transport: 'acp-stdio',
      });
      options.onSessionId('grok-native-session');
      await options.onEvents([
        {
          data: { reason: 'complete', transport: 'acp-stdio' },
          operationId: options.operationId,
          stepIndex: 0,
          timestamp: now,
          type: 'agent_runtime_end',
        },
      ]);
      options.onRuntimeStatus({
        activeTasks: [],
        lastEventAt: now,
        operationId: options.operationId,
        sessionId: options.sessionId,
        state: 'closed',
        transport: 'acp-stdio',
      });
    });
    loggerInfoMock.mockReset();
    beginServerDefaultOperationMock.mockReset();
    beginServerDefaultOperationMock.mockResolvedValue({
      endpoint: 'https://app.example.com',
      model: 'lobehub-default',
      token: 'operation-token',
    });
    getProviderBindingRuntimeMock.mockReset();
    getProviderBindingRuntimeMock.mockResolvedValue({
      enabled: true,
      runtimeConfig: {
        config: { enableResponseApi: true },
        keyVaults: { apiKey: 'provider-secret' },
        settings: { sdkType: 'openai', supportResponsesApi: true },
      },
    });
    getServerDefaultEndpointMock.mockReset();
    getServerDefaultEndpointMock.mockResolvedValue('https://app.example.com');
    settleServerDefaultOperationMock.mockReset();
    settleServerDefaultOperationMock.mockResolvedValue(undefined);
    traeAcpSessionCloseMock.mockReset();
    traeAcpSessionConstructMock.mockReset();
    traeAcpSessionInterruptMock.mockReset();
    traeAcpSessionRunMock.mockReset();
    droidAcpSessionCloseMock.mockReset();
    droidAcpSessionConstructMock.mockReset();
    droidAcpSessionInterruptMock.mockReset();
    droidAcpSessionRunMock.mockReset();
    mockGetAllWindows.mockReset();
    platformMock.mockReturnValue('linux');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(statSync).mockReturnValue(asDirectory);
    delete process.env.LOBE_CLAUDE_CODE_SDK;
    delete process.env.LOBE_CODEX_APP_SERVER;
  });

  afterEach(async () => {
    if (originalClaudeSdkLabEnv === undefined) delete process.env.LOBE_CLAUDE_CODE_SDK;
    else process.env.LOBE_CLAUDE_CODE_SDK = originalClaudeSdkLabEnv;
    if (originalCodexAppServerLabEnv === undefined) delete process.env.LOBE_CODEX_APP_SERVER;
    else process.env.LOBE_CODEX_APP_SERVER = originalCodexAppServerLabEnv;
    await rm(appStoragePath, { force: true, recursive: true });
  });

  describe('cancelSession', () => {
    /**
     * @example A replacement local Codex turn starts only after the interrupted CLI exits.
     */
    it('does not resolve CLI cancellation until the native process exits', async () => {
      // ROOT CAUSE:
      //
      // cancelSession previously sent SIGINT and returned immediately. “Send now”
      // could then start a second `codex exec resume` while the first process still
      // owned the thread writer.
      //
      // Before: signal the child and schedule a detached escalation timer.
      // After: signal, await exit, and synchronously escalate after a bounded wait.
      const { proc } = createFakeProc();
      proc.__start = vi.fn();
      proc.exitCode = null;
      proc.signalCode = null;
      nextFakeProc = proc;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
      });
      const prompt = ctr.sendPrompt({
        operationId: 'op-cancel-wait',
        prompt: 'sleep 60',
        sessionId,
      });
      await vi.waitFor(() => expect(spawnCalls).toHaveLength(1));

      let cancellationSettled = false;
      const cancellation = ctr.cancelSession({ sessionId }).then(() => {
        cancellationSettled = true;
      });
      await Promise.resolve();

      expect(cancellationSettled).toBe(false);

      proc.stdout.end();
      proc.stderr.end();
      proc.signalCode = 'SIGINT';
      proc.emit('exit', null, 'SIGINT');

      await cancellation;
      await prompt;
    });

    /**
     * @example A wedged native process ignores both graceful and forced termination.
     */
    it('rejects cancellation when process exit is not observed after SIGKILL', async () => {
      // ROOT CAUSE:
      //
      // cancelSession awaited the post-SIGKILL timeout but discarded its false
      // result. Callers therefore started replacement turns even though the old
      // process could still own the native Codex thread writer.
      //
      // Before: await forcedExit; return undefined.
      // After: throw when forcedExit resolves false.
      const processKill = vi.spyOn(process, 'kill').mockReturnValue(true);

      try {
        const { proc } = createFakeProc();
        proc.__start = vi.fn();
        proc.exitCode = null;
        proc.pid = 4242;
        proc.signalCode = null;
        nextFakeProc = proc;
        const ctr = new HeterogeneousAgentCtr({
          appStoragePath,
          storeManager: { get: vi.fn() },
        } as unknown as ConstructorParameters<typeof HeterogeneousAgentCtr>[0]);
        const { sessionId } = await ctr.startSession({
          agentType: 'codex',
          command: 'codex',
        });
        const spawnCount = spawnCalls.length;
        const prompt = ctr.sendPrompt({
          operationId: 'op-cancel-timeout',
          prompt: 'ignore termination',
          sessionId,
        });
        await vi.waitFor(() => expect(spawnCalls).toHaveLength(spawnCount + 1));

        vi.useFakeTimers();
        const cancellation = expect(ctr.cancelSession({ sessionId })).rejects.toThrow(
          `Session ${sessionId} did not exit after SIGKILL`,
        );
        await vi.advanceTimersByTimeAsync(4000);
        await cancellation;

        expect(processKill).toHaveBeenNthCalledWith(1, -4242, 'SIGINT');
        expect(processKill).toHaveBeenNthCalledWith(2, -4242, 'SIGKILL');

        vi.useRealTimers();
        proc.stdout.end();
        proc.stderr.end();
        proc.signalCode = 'SIGKILL';
        proc.emit('exit', null, 'SIGKILL');
        await prompt;
      } finally {
        processKill.mockRestore();
        vi.useRealTimers();
      }
    });
  });

  describe('image cache (delegates to shared `normalizeImage`)', () => {
    // Image fetch + cache moved to `@lobechat/heterogeneous-agents/spawn`'s
    // `normalizeImage`. The desktop controller passes its own cacheDir so the
    // path-traversal invariant — id segments like `../../foo` MUST be hashed,
    // never used as path segments — is enforced by the shared helper. Verify
    // that invariant against the same cacheDir the controller would use.
    const fixtureCacheDir = (storage: string) => path.join(storage, 'heteroAgent/files');
    const importNormalize = async () => {
      const { mkdir } = await import('node:fs/promises');
      const mod = await import('@lobechat/heterogeneous-agents/spawn');
      return { mkdir, normalizeImage: mod.normalizeImage };
    };

    it('stores traversal-looking ids inside the cache root via a stable hash key', async () => {
      const { mkdir, normalizeImage } = await importNormalize();
      const cacheDir = fixtureCacheDir(appStoragePath);
      await mkdir(cacheDir, { recursive: true });

      const escapedTargetName = `${path.basename(appStoragePath)}-outside-storage`;
      const escapePath = path.join(cacheDir, `../../../${escapedTargetName}`);

      try {
        await unlink(escapePath);
      } catch {
        // best-effort cleanup
      }

      await normalizeImage(
        {
          id: `../../../${escapedTargetName}`,
          type: 'url',
          url: 'data:text/plain;base64,T1VUU0lERQ==',
        },
        { cacheDir, fetcher: (async () => new Response('OUTSIDE', { status: 200 })) as any },
      );

      const cacheEntries = await readdir(cacheDir);

      expect(cacheEntries).toHaveLength(2);
      expect(cacheEntries.every((entry) => /^[a-f0-9]{64}(?:\.meta)?$/.test(entry))).toBe(true);
      await expect(access(escapePath)).rejects.toThrow();

      try {
        await unlink(escapePath);
      } catch {
        // best-effort cleanup
      }
    });

    it('does not trust pre-seeded out-of-root traversal cache files as cache hits', async () => {
      const { mkdir, normalizeImage } = await importNormalize();
      const cacheDir = fixtureCacheDir(appStoragePath);
      await mkdir(cacheDir, { recursive: true });

      const traversalId = '../../preexisting-secret';
      const outOfRootDataPath = path.join(cacheDir, traversalId);
      const outOfRootMetaPath = path.join(cacheDir, `${traversalId}.meta`);

      await writeFile(outOfRootDataPath, 'SECRET');
      await writeFile(
        outOfRootMetaPath,
        JSON.stringify({ id: traversalId, mimeType: 'text/plain' }),
      );

      const result = await normalizeImage(
        { id: traversalId, type: 'url', url: 'data:text/plain;base64,SUdOT1JFRA==' },
        {
          cacheDir,
          fetcher: (async () =>
            new Response('IGNORED', {
              headers: { 'content-type': 'text/plain' },
              status: 200,
            })) as any,
        },
      );

      expect(Buffer.from(result.buffer).toString('utf8')).toBe('IGNORED');
      expect(result.mediaType).toBe('text/plain');
      await expect(readFile(outOfRootDataPath, 'utf8')).resolves.toBe('SECRET');
    });
  });

  describe('getCodexQuota', () => {
    beforeEach(() => {
      execFileMock.mockReset();
    });

    it('forwards desktop proxy env to the Codex quota RPC', async () => {
      execFileMock.mockImplementation(
        (
          _file: string,
          _args: string[],
          optionsOrCallback: unknown,
          callback?: (error: Error | null, result: { stderr: string; stdout: string }) => void,
        ) => {
          const resolvedCallback =
            typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          resolvedCallback?.(null, { stderr: '', stdout: 'codex-cli 0.99.0' });
        },
      );
      fetchCodexQuotaMock.mockResolvedValue({
        error: null,
        provider: 'codex',
        session: null,
        status: 'ok',
        updatedAt: 1,
        weekly: null,
      });
      const networkProxy = {
        enableProxy: true,
        proxyPort: '7890',
        proxyServer: '127.0.0.1',
        proxyType: 'http',
      };
      const storeGet = vi.fn((key: string) => (key === 'networkProxy' ? networkProxy : undefined));
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: storeGet },
      } as any);

      await ctr.getCodexQuota({
        command: '/custom/bin/codex',
        env: { CODEX_HOME: '/tmp/codex-home', PATH: '/custom/bin' },
      });

      expect(storeGet).toHaveBeenCalledWith('networkProxy');
      expect(fetchCodexQuotaMock).toHaveBeenCalledWith({
        command: '/custom/bin/codex',
        env: expect.objectContaining({
          CODEX_HOME: '/tmp/codex-home',
          HTTPS_PROXY: 'http://127.0.0.1:7890',
          HTTP_PROXY: 'http://127.0.0.1:7890',
          PATH: '/custom/bin',
        }),
      });
    });

    it('reuses automatic quota reads while explicit refresh bypasses the cache', async () => {
      execFileMock.mockImplementation(
        (
          _file: string,
          _args: string[],
          optionsOrCallback: unknown,
          callback?: (error: Error | null, result: { stderr: string; stdout: string }) => void,
        ) => {
          const resolvedCallback =
            typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          resolvedCallback?.(null, { stderr: '', stdout: 'codex-cli 0.99.0' });
        },
      );
      fetchCodexQuotaMock.mockResolvedValue({
        error: null,
        provider: 'codex',
        session: { resetsAt: null, usedPercent: 8, windowMinutes: 300 },
        status: 'ok',
        updatedAt: Date.now(),
        weekly: null,
      });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const params = { command: '/custom/bin/codex', env: { CODEX_HOME: '/tmp/codex-home' } };

      await ctr.getCodexQuota(params);
      await ctr.getCodexQuota(params);

      expect(fetchCodexQuotaMock).toHaveBeenCalledTimes(1);

      await ctr.getCodexQuota({ ...params, force: true });

      expect(fetchCodexQuotaMock).toHaveBeenCalledTimes(2);
    });

    it('consumes a reset credit and replaces the cached quota with a fresh snapshot', async () => {
      execFileMock.mockImplementation(
        (
          _file: string,
          _args: string[],
          optionsOrCallback: unknown,
          callback?: (error: Error | null, result: { stderr: string; stdout: string }) => void,
        ) => {
          const resolvedCallback =
            typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          resolvedCallback?.(null, { stderr: '', stdout: 'codex-cli 0.99.0' });
        },
      );
      const initialQuota = {
        error: null,
        provider: 'codex',
        rateLimitResetCredits: { availableCount: 2 },
        session: { resetsAt: null, usedPercent: 96, windowMinutes: 300 },
        status: 'ok',
        updatedAt: 1,
        weekly: null,
      };
      const refreshedQuota = {
        ...initialQuota,
        rateLimitResetCredits: { availableCount: 1 },
        session: { resetsAt: null, usedPercent: 0, windowMinutes: 300 },
        updatedAt: 2,
      };
      fetchCodexQuotaMock.mockResolvedValueOnce(initialQuota).mockResolvedValueOnce(refreshedQuota);
      consumeCodexRateLimitResetCreditMock.mockResolvedValue('reset');
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const source = {
        command: '/custom/bin/codex',
        env: { CODEX_HOME: '/tmp/codex-home' },
      };

      await ctr.getCodexQuota(source);
      await expect(
        ctr.consumeCodexRateLimitResetCredit({
          ...source,
          creditId: 'credit-first',
          idempotencyKey: 'redeem-request-1',
        }),
      ).resolves.toEqual({ outcome: 'reset', quota: refreshedQuota });

      expect(consumeCodexRateLimitResetCreditMock).toHaveBeenCalledWith({
        command: '/custom/bin/codex',
        creditId: 'credit-first',
        env: { CODEX_HOME: '/tmp/codex-home' },
        idempotencyKey: 'redeem-request-1',
      });
      expect(fetchCodexQuotaMock).toHaveBeenCalledTimes(2);
    });

    it('bypasses an in-flight pre-reset quota read after consuming a credit', async () => {
      execFileMock.mockImplementation(
        (
          _file: string,
          _args: string[],
          optionsOrCallback: unknown,
          callback?: (error: Error | null, result: { stderr: string; stdout: string }) => void,
        ) => {
          const resolvedCallback =
            typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          resolvedCallback?.(null, { stderr: '', stdout: 'codex-cli 0.99.0' });
        },
      );
      const refreshedAt = Date.now();
      const staleQuota = {
        error: null,
        provider: 'codex',
        rateLimitResetCredits: { availableCount: 2 },
        session: { resetsAt: null, usedPercent: 96, windowMinutes: 300 },
        status: 'ok',
        updatedAt: refreshedAt - 1,
        weekly: null,
      } satisfies CodexQuotaSnapshot;
      const refreshedQuota = {
        ...staleQuota,
        rateLimitResetCredits: { availableCount: 1 },
        session: { resetsAt: null, usedPercent: 0, windowMinutes: 300 },
        updatedAt: refreshedAt,
      } satisfies CodexQuotaSnapshot;
      let resolveStaleQuota: ((quota: CodexQuotaSnapshot) => void) | undefined;
      fetchCodexQuotaMock
        .mockImplementationOnce(
          () =>
            new Promise<CodexQuotaSnapshot>((resolve) => {
              resolveStaleQuota = resolve;
            }),
        )
        .mockResolvedValueOnce(refreshedQuota);
      consumeCodexRateLimitResetCreditMock.mockResolvedValue('reset');
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const source = {
        command: '/custom/bin/codex',
        env: { CODEX_HOME: '/tmp/codex-home' },
      };

      const staleRequest = ctr.getCodexQuota(source);
      await vi.waitFor(() => expect(fetchCodexQuotaMock).toHaveBeenCalledTimes(1));

      await expect(
        ctr.consumeCodexRateLimitResetCredit({
          ...source,
          creditId: 'credit-first',
          idempotencyKey: 'redeem-request-2',
        }),
      ).resolves.toEqual({ outcome: 'reset', quota: refreshedQuota });

      resolveStaleQuota?.(staleQuota);
      await expect(staleRequest).resolves.toEqual(staleQuota);
      await expect(ctr.getCodexQuota(source)).resolves.toEqual(refreshedQuota);
      expect(fetchCodexQuotaMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendPrompt (claude-code)', () => {
    beforeEach(() => {
      spawnCalls.length = 0;
      execFileMock.mockReset();
    });

    const runSendPrompt = async (
      prompt: string,
      sessionOverrides: Record<string, any> = {},
      stdoutLines: string[] = [],
      sendPromptOverrides: Partial<{
        imageList: Array<{ id: string; url: string }>;
        systemContext: string;
      }> = {},
    ) => {
      const { proc, writes } = createFakeProc({ stdoutLines });
      nextFakeProc = proc;

      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'claude-code',
        command: 'claude',
        ...sessionOverrides,
      });
      await ctr.sendPrompt({ operationId: 'op-test', prompt, sessionId, ...sendPromptOverrides });

      const { args: cliArgs, command, options } = spawnCalls[0];
      return { cliArgs, command, ctr, options, sessionId, writes };
    };

    it('passes prompt via stdin stream-json — never as a positional arg', async () => {
      const prompt = '-- 这是破折号测试 --help';
      const { cliArgs, writes } = await runSendPrompt(prompt);

      // Prompt must never appear in argv (that is what previously broke CC's arg parser).
      expect(cliArgs).not.toContain(prompt);

      // Stream-json input must be wired up.
      expect(cliArgs).toContain('--input-format');
      expect(cliArgs).toContain('--output-format');
      expect(cliArgs.filter((a) => a === 'stream-json')).toHaveLength(2);

      // Exactly one stdin write, carrying the prompt as a user message JSON line.
      expect(writes).toHaveLength(1);
      const line = writes[0].trimEnd();
      expect(line.endsWith('\n') || writes[0].endsWith('\n')).toBe(true);
      const msg = JSON.parse(line);
      expect(msg).toMatchObject({
        message: {
          content: [{ text: prompt, type: 'text' }],
          role: 'user',
        },
        type: 'user',
      });
    });

    it('places system context before the user prompt in stream-json content blocks', async () => {
      const { writes } = await runSendPrompt('user task', {}, [], {
        systemContext: 'selected code context',
      });

      expect(writes).toHaveLength(1);
      const msg = JSON.parse(writes[0].trimEnd());
      expect(msg.message.content).toEqual([
        { text: 'selected code context', type: 'text' },
        { text: 'user task', type: 'text' },
      ]);
    });

    it('cleans up the intervention when Windows command-line validation rejects before spawn', async () => {
      platformMock.mockReturnValue('win32');
      const operationId = 'op-oversized-windows-argv';
      const tmpConfigPath = path.join(os.tmpdir(), `lobe-cc-mcp-${operationId}.json`);
      await rm(tmpConfigPath, { force: true });

      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        binaryManager: {
          detect: vi.fn().mockResolvedValue({
            available: true,
            path: 'C:\\claude.exe',
          }),
        },
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'claude-code',
        args: ['a'.repeat(32_767)],
        command: 'claude',
      });

      await expect(
        ctr.sendPrompt({
          agentId: 'agent-1',
          operationId,
          prompt: 'hello',
          sessionId,
          topicId: 'topic-1',
        }),
      ).rejects.toThrow(/resolved Windows command line requires/);

      expect(spawnCalls).toHaveLength(0);
      expect((ctr as any).opIdToIntervention.has(operationId)).toBe(false);
      expect((ctr as any).opIdToBrowserBinding.has(operationId)).toBe(false);
      expect((ctr as any).builtinMcpServer.hasOperation(operationId)).toBe(false);
      await expect(access(tmpConfigPath)).rejects.toThrow();
    });

    it('uses Claude SDK streaming lab instead of spawning claude -p', async () => {
      process.env.LOBE_CLAUDE_CODE_SDK = '1';
      const send = vi.fn();
      mockGetAllWindows.mockReturnValue([
        {
          isDestroyed: () => false,
          webContents: { send },
        },
      ]);
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'claude-code',
        args: ['--model', 'claude-sonnet-4-6', '--effort', 'medium'],
        command: 'claude',
      });

      await ctr.sendPrompt({ operationId: 'op-test', prompt: 'watch ci', sessionId });

      expect(spawnCalls).toHaveLength(0);
      expect(claudeSdkSessionConstructMock).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ['--model', 'claude-sonnet-4-6', '--effort', 'medium'],
          commandPath: 'claude',
          cwd: FAKE_DESKTOP_PATH,
          operationId: 'op-test',
          stdinPayload: expect.stringContaining('watch ci'),
          // `Read` on an image echoes base64; without this the SDK path would
          // persist an `[Image: …]` placeholder instead of a thumbnail.
          uploadImage: expect.any(Function),
        }),
      );

      const statusPayloads = send.mock.calls
        .filter(([channel]) => channel === 'heteroAgentRuntimeStatus')
        .map(([, payload]) => payload);
      expect(statusPayloads.some((payload) => payload.state === 'monitoring')).toBe(true);
      expect(statusPayloads.at(-1)).toMatchObject({
        state: 'closed',
        transport: 'claude-sdk',
      });

      const streamEvents = send.mock.calls
        .filter(([channel]) => channel === 'heteroAgentEvent')
        .map(([, payload]) => payload.event);
      expect(streamEvents.some((event) => event.type === 'agent_runtime_end')).toBe(true);
      expect(send).toHaveBeenCalledWith('heteroAgentSessionComplete', { sessionId });
    });

    it('does not start the Claude SDK when server-default execution is cancelled during preparation', async () => {
      process.env.LOBE_CLAUDE_CODE_SDK = '1';
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'claude-code',
        command: 'claude',
        providerBinding: {
          apiConfig: { model: 'claude-sonnet-4-6', source: 'server-default' },
          kind: 'server-default',
        },
      });
      let completePreparation!: () => void;
      const createTraceSession = vi
        .spyOn(ctr as any, 'createCliTraceSession')
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              completePreparation = resolve;
            }),
        );

      const sendPrompt = ctr.sendPrompt({
        agentId: 'agent-1',
        operationId: 'op-cancel-sdk-preparation',
        prompt: 'watch ci',
        sessionId,
        topicId: 'topic-1',
      });
      await vi.waitFor(() => expect(createTraceSession).toHaveBeenCalledOnce());

      await ctr.cancelSession({ sessionId });
      completePreparation();
      await sendPrompt;

      expect(claudeSdkSessionConstructMock).not.toHaveBeenCalled();
      expect(spawnCalls).toHaveLength(0);
      expect(settleServerDefaultOperationMock).toHaveBeenCalledWith(expect.any(Object), {
        cancelled: true,
        operationId: 'op-cancel-sdk-preparation',
        result: 'error',
      });
    });

    it.each([
      '-flag-looking-prompt',
      '--help please',
      '- dash at start',
      '-p -- mixed',
      'normal prompt with -dash- inside',
    ])('accepts dash-containing prompt without leaking to argv: %s', async (prompt) => {
      const { cliArgs, writes } = await runSendPrompt(prompt);

      expect(cliArgs).not.toContain(prompt);
      expect(writes).toHaveLength(1);
      const msg = JSON.parse(writes[0].trimEnd());
      expect(msg.message.content[0].text).toBe(prompt);
    });

    it('falls back to the user Desktop when no cwd is supplied', async () => {
      const { options } = await runSendPrompt('hello');

      // When launched from Finder the Electron parent cwd is `/` — the
      // controller must override that with the user's Desktop so CC writes
      // land somewhere sensible.
      expect(options.cwd).toBe(FAKE_DESKTOP_PATH);
    });

    it('respects an explicit cwd passed to startSession', async () => {
      const explicitCwd = '/Users/fake/projects/my-repo';
      const { options } = await runSendPrompt('hello', { cwd: explicitCwd });

      expect(options.cwd).toBe(explicitCwd);
    });

    it('omits the empty text block when only images are attached', async () => {
      const { writes } = await runSendPrompt('', {}, [], {
        imageList: [{ id: 'image-1', url: 'data:image/png;base64,UE5HX1RFU1Q=' }],
      });

      expect(writes).toHaveLength(1);
      const msg = JSON.parse(writes[0].trimEnd());
      // Anthropic rejects `{ text: '', type: 'text' }` with
      // "messages: text content blocks must be non-empty".
      expect(msg.message.content).toEqual([
        {
          source: { data: 'UE5HX1RFU1Q=', media_type: 'image/png', type: 'base64' },
          type: 'image',
        },
      ]);
    });

    it('does not leak host Anthropic auth env into the spawned CLI', async () => {
      // A developer with these exported in their shell would otherwise have them
      // forwarded to `claude`, overriding its subscription login and surfacing
      // as a baffling "Invalid API key" / non-zero exit. Regression guard for
      // that env-leak.
      const original = {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
      };
      process.env.ANTHROPIC_API_KEY = 'sk-host-should-not-leak';
      process.env.ANTHROPIC_AUTH_TOKEN = 'host-token-should-not-leak';
      process.env.ANTHROPIC_BASE_URL = 'https://host.example/should-not-leak';

      try {
        const { options } = await runSendPrompt('hello');

        expect(options.env).not.toHaveProperty('ANTHROPIC_API_KEY');
        expect(options.env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
        expect(options.env).not.toHaveProperty('ANTHROPIC_BASE_URL');
        // Unrelated inherited vars must still pass through.
        expect(options.env.PATH).toBe(process.env.PATH);
      } finally {
        for (const [key, value] of Object.entries(original)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });

    it('lets an agent-configured Anthropic key in session.env override the stripped host env', async () => {
      const originalKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'sk-host-should-not-leak';

      try {
        const { options } = await runSendPrompt('hello', {
          env: { ANTHROPIC_API_KEY: 'sk-agent-explicit' },
        });

        // Explicit per-agent config wins; the host value is never seen.
        expect(options.env.ANTHROPIC_API_KEY).toBe('sk-agent-explicit');
      } finally {
        if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = originalKey;
      }
    });

    it('disables CodeBuddy background tasks in the spawned environment', async () => {
      const { cliArgs, options } = await runSendPrompt('hello', {
        agentType: 'codebuddy',
        command: 'codebuddy',
      });

      expect(cliArgs).toContain('--include-partial-messages');
      expect(options.env.CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS).toBe('1');
    });

    it('passes the selected model to the native CodeBuddy process', async () => {
      const { cliArgs } = await runSendPrompt('hello', {
        agentType: 'codebuddy',
        args: ['--model', 'gpt-5.4'],
        command: 'codebuddy',
      });

      expect(cliArgs).toContain('--model');
      expect(cliArgs[cliArgs.indexOf('--model') + 1]).toBe('gpt-5.4');
    });

    it('captures the Claude Code session id from stream-json init events', async () => {
      const { ctr, sessionId } = await runSendPrompt('hello', {}, [
        `${JSON.stringify({ session_id: 'sess_cc_123', subtype: 'init', type: 'system' })}\n`,
      ]);

      await expect(ctr.getSessionInfo({ sessionId })).resolves.toEqual({
        agentSessionId: 'sess_cc_123',
      });
    });
  });

  describe('sendPrompt (cursor)', () => {
    beforeEach(() => {
      spawnCalls.length = 0;
      execFileMock.mockReset();
    });

    it('routes Cursor through ACP and persists its native session id', async () => {
      const send = vi.fn();
      mockGetAllWindows.mockReturnValue([
        {
          isDestroyed: () => false,
          webContents: { send },
        },
      ]);
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'cursor',
        args: ['--model', 'composer-1.5'],
        command: 'agent',
        resumeSessionId: 'cursor-session-old',
      });

      await ctr.sendPrompt({
        operationId: 'op-cursor',
        prompt: 'private user request',
        sessionId,
        systemContext: 'private selected workspace context',
      });

      expect(spawnCalls).toHaveLength(0);
      expect(cursorAcpSessionConstructMock).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ['--model', 'composer-1.5'],
          askUserBridge: expect.any(Object),
          clientVersion: '1.0.0-test',
          commandPath: 'agent',
          cwd: FAKE_DESKTOP_PATH,
          operationId: 'op-cursor',
          prompt: [
            { text: 'private selected workspace context', type: 'text' },
            { text: 'private user request', type: 'text' },
          ],
          resumeSessionId: 'cursor-session-old',
          sessionId,
        }),
      );
      await expect(ctr.getSessionInfo({ sessionId })).resolves.toEqual({
        agentSessionId: 'cursor-session-1',
      });
      expect(send).toHaveBeenCalledWith(
        'heteroAgentRuntimeStatus',
        expect.objectContaining({ state: 'running', transport: 'cursor-acp' }),
      );
      expect(send).toHaveBeenCalledWith('heteroAgentSessionComplete', { sessionId });
    });

    it('forwards Cursor questions through the existing intervention bridge and returns the answer', async () => {
      const send = vi.fn();
      mockGetAllWindows.mockReturnValue([
        {
          isDestroyed: () => false,
          webContents: { send },
        },
      ]);
      let receivedAnswer: unknown;
      cursorAcpSessionRunMock.mockImplementation(async (options) => {
        receivedAnswer = await options.askUserBridge.pending({
          arguments: {
            questions: [
              {
                header: 'Scope',
                multiSelect: false,
                options: [{ label: 'Narrow' }, { label: 'Full' }],
                question: 'How broad?',
              },
            ],
          },
          toolCallId: 'cursor-question-1',
        });
      });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({ agentType: 'cursor', command: 'agent' });
      const run = ctr.sendPrompt({ operationId: 'op-cursor-question', prompt: 'work', sessionId });

      await vi.waitFor(() =>
        expect(send).toHaveBeenCalledWith(
          'heteroAgentEvent',
          expect.objectContaining({
            event: expect.objectContaining({
              data: expect.objectContaining({ toolCallId: 'cursor-question-1' }),
              type: 'agent_intervention_request',
            }),
            sessionId,
          }),
        ),
      );
      await ctr.submitIntervention({
        operationId: 'op-cursor-question',
        result: { 'How broad?': 'Full' },
        toolCallId: 'cursor-question-1',
      });
      await run;

      expect(receivedAnswer).toEqual({ result: { 'How broad?': 'Full' } });
    });

    it('classifies an exact Cursor ACP session/load not-found error for resume fallback', async () => {
      const send = vi.fn();
      mockGetAllWindows.mockReturnValue([
        {
          isDestroyed: () => false,
          webContents: { send },
        },
      ]);
      const missingSessionError = new AcpRpcResponseError('session/load', {
        code: -32_602,
        message: 'Session "legacy-cursor-session" not found',
      });
      cursorAcpSessionRunMock.mockImplementation(async (options) => {
        await options.onStderr('Cursor ACP diagnostic\n');
        throw missingSessionError;
      });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'cursor',
        command: 'agent',
        cwd: '/Users/fake/projects/repo',
        resumeSessionId: 'legacy-cursor-session',
      });

      await expect(
        ctr.sendPrompt({ operationId: 'op-cursor-resume', prompt: 'continue', sessionId }),
      ).rejects.toThrow(
        'The saved Cursor session cannot be loaded through ACP, so a new conversation will start.',
      );

      expect(send).toHaveBeenCalledWith('heteroAgentSessionError', {
        error: {
          agentType: 'cursor',
          code: HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound,
          command: 'agent',
          details: {
            code: -32_602,
            message: 'Session "legacy-cursor-session" not found',
          },
          message:
            'The saved Cursor session cannot be loaded through ACP, so a new conversation will start.',
          resumeSessionId: 'legacy-cursor-session',
          stderr: missingSessionError.message,
          workingDirectory: '/Users/fake/projects/repo',
        },
        sessionId,
      });
      expect(send).not.toHaveBeenCalledWith('heteroAgentSessionComplete', { sessionId });
    });

    it.each([
      ['cancelSession', cursorAcpSessionInterruptMock],
      ['stopSession', cursorAcpSessionCloseMock],
    ] as const)('%s delegates to the active Cursor ACP session', async (action, expectedMock) => {
      let resolveRun: (() => void) | undefined;
      cursorAcpSessionRunMock.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveRun = resolve;
          }),
      );
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({ agentType: 'cursor', command: 'agent' });
      const run = ctr.sendPrompt({ operationId: 'op-cursor', prompt: 'work', sessionId });
      await vi.waitFor(() => expect(cursorAcpSessionConstructMock).toHaveBeenCalledOnce());

      await ctr[action]({ sessionId });

      expect(expectedMock).toHaveBeenCalledOnce();
      resolveRun?.();
      await run;
    });
  });

  describe('sendPrompt (grok-build ACP)', () => {
    beforeEach(() => {
      spawnCalls.length = 0;
      execFileMock.mockReset();
    });

    it('uses the ACP runtime, persists the native session id, and broadcasts its lifecycle', async () => {
      const send = vi.fn();
      mockGetAllWindows.mockReturnValue([
        {
          isDestroyed: () => false,
          webContents: { send },
        },
      ]);
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'grok-build',
        args: ['--model', 'grok-build'],
        command: 'grok',
      });

      await ctr.sendPrompt({
        operationId: 'op-grok',
        prompt: 'implement this',
        sessionId,
        systemContext: 'selected context',
      });

      expect(spawnCalls).toHaveLength(0);
      expect(grokAcpSessionConstructMock).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ['--model', 'grok-build'],
          clientVersion: '1.0.0-test',
          commandPath: 'grok',
          cwd: FAKE_DESKTOP_PATH,
          operationId: 'op-grok',
          prompt: [
            { text: 'selected context', type: 'text' },
            { text: 'implement this', type: 'text' },
          ],
          sessionId,
        }),
      );
      await expect(ctr.getSessionInfo({ sessionId })).resolves.toEqual({
        agentSessionId: 'grok-native-session',
      });

      const statusPayloads = send.mock.calls
        .filter(([channel]) => channel === 'heteroAgentRuntimeStatus')
        .map(([, payload]) => payload);
      expect(statusPayloads).toEqual([
        expect.objectContaining({ state: 'running', transport: 'acp-stdio' }),
        expect.objectContaining({ state: 'closed', transport: 'acp-stdio' }),
      ]);
      expect(send).toHaveBeenCalledWith(
        'heteroAgentEvent',
        expect.objectContaining({
          event: expect.objectContaining({ type: 'agent_runtime_end' }),
          sessionId,
        }),
      );
      expect(send).toHaveBeenCalledWith('heteroAgentSessionComplete', { sessionId });
    });

    it('launches provider-bound Grok with a managed secret-free profile', async () => {
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'grok-build',
        args: ['--model', 'stale-model', '--effort', 'high'],
        command: 'grok',
        env: {
          GROK_CODE_XAI_API_KEY: 'stale-legacy-key',
          GROK_CONFIG: 'untrusted',
          XAI_API_KEY: 'stale-key',
        },
        providerBinding: {
          apiConfig: { model: 'gpt-test', providerId: 'openai' },
          kind: 'provider',
        },
      });

      const originalLegacyApiKey = process.env.GROK_CODE_XAI_API_KEY;
      const originalXaiApiKey = process.env.XAI_API_KEY;
      process.env.GROK_CODE_XAI_API_KEY = 'inherited-legacy-key';
      process.env.XAI_API_KEY = 'inherited-xai-key';
      try {
        await ctr.sendPrompt({ operationId: 'op-grok-provider', prompt: 'hello', sessionId });
      } finally {
        if (originalLegacyApiKey === undefined) delete process.env.GROK_CODE_XAI_API_KEY;
        else process.env.GROK_CODE_XAI_API_KEY = originalLegacyApiKey;
        if (originalXaiApiKey === undefined) delete process.env.XAI_API_KEY;
        else process.env.XAI_API_KEY = originalXaiApiKey;
      }

      const options = grokAcpSessionConstructMock.mock.calls.at(-1)?.[0];
      expect(options.args).toEqual([
        '--effort',
        'high',
        '--model',
        expect.stringMatching(/^lobehub-provider-[\da-f]{16}$/),
      ]);
      expect(options.env).toEqual(
        expect.objectContaining({
          GROK_CONFIG: '',
          GROK_DEFAULT_MODEL: '',
          GROK_HOME: expect.stringContaining('/heteroAgent/bindings/grok-build/'),
          LOBEHUB_GROK_API_KEY: 'provider-secret',
        }),
      );
      expect(options.env).not.toHaveProperty('GROK_CODE_XAI_API_KEY');
      expect(options.env).not.toHaveProperty('XAI_API_KEY');

      const bindingsDir = path.join(appStoragePath, 'heteroAgent', 'bindings', 'grok-build');
      const [bindingDir] = await readdir(bindingsDir);
      const config = await readFile(path.join(bindingsDir, bindingDir, 'config.toml'), 'utf8');
      expect(config).toContain('model = "gpt-test"');
      expect(config).toContain('base_url = "https://api.openai.com/v1"');
      expect(config).toContain('api_backend = "responses"');
      expect(config).not.toContain('provider-secret');
      expect(JSON.stringify(loggerInfoMock.mock.calls)).not.toContain('provider-secret');
      expect(await readdir(path.join(appStoragePath, 'heteroAgent', 'runs'))).toEqual([]);
    });

    it.each([
      ['cancelSession', grokAcpSessionInterruptMock],
      ['stopSession', grokAcpSessionCloseMock],
    ] as const)('%s delegates to the active ACP session', async (action, expectedMock) => {
      let resolveRun: (() => void) | undefined;
      grokAcpSessionRunMock.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveRun = resolve;
          }),
      );
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'grok-build',
        command: 'grok',
      });
      const promptRun = ctr.sendPrompt({ operationId: 'op-grok', prompt: 'work', sessionId });
      await vi.waitFor(() => expect(grokAcpSessionConstructMock).toHaveBeenCalledOnce());

      await ctr[action]({ sessionId });

      expect(expectedMock).toHaveBeenCalledOnce();
      resolveRun?.();
      await promptRun;
    });

    it('classifies ACP authentication failures for the existing sign-in guide', async () => {
      const send = vi.fn();
      mockGetAllWindows.mockReturnValue([
        {
          isDestroyed: () => false,
          webContents: { send },
        },
      ]);
      grokAcpSessionRunMock.mockRejectedValue(
        new Error('Authentication required. Run `grok login`, then retry.'),
      );
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'grok-build',
        command: 'grok',
      });

      await expect(
        ctr.sendPrompt({ operationId: 'op-grok', prompt: 'work', sessionId }),
      ).rejects.toThrow('Grok Build could not authenticate');
      expect(send).toHaveBeenCalledWith('heteroAgentSessionError', {
        error: expect.objectContaining({
          agentType: 'grok-build',
          code: HeterogeneousAgentSessionErrorCode.AuthRequired,
          command: 'grok',
        }),
        sessionId,
      });
    });

    it('classifies a missing resumed ACP session after broadcasting its terminal error', async () => {
      const send = vi.fn();
      mockGetAllWindows.mockReturnValue([
        {
          isDestroyed: () => false,
          webContents: { send },
        },
      ]);
      const missingSessionError = new AcpRpcResponseError('session/load', {
        code: -32_603,
        data: { code: 'FS_NOT_FOUND', detail: '/sessions/missing-grok-session' },
        message: 'Path not found.',
      });
      grokAcpSessionRunMock.mockImplementation(async (options) => {
        await options.onEvents([
          {
            data: {
              agentType: 'grok-build',
              details: {
                code: missingSessionError.rpcError.code,
                data: missingSessionError.rpcError.data,
              },
              message: missingSessionError.message,
            },
            operationId: options.operationId,
            stepIndex: 0,
            timestamp: Date.now(),
            type: 'error',
          },
        ]);
        throw missingSessionError;
      });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'grok-build',
        command: 'grok',
        cwd: '/Users/fake/projects/repo',
        resumeSessionId: 'missing-grok-session',
      });

      await expect(
        ctr.sendPrompt({ operationId: 'op-grok-resume', prompt: 'continue', sessionId }),
      ).rejects.toThrow(
        'The saved Grok Build session could not be found, so it can no longer be resumed.',
      );

      expect(grokAcpSessionConstructMock).toHaveBeenCalledWith(
        expect.objectContaining({ resumeSessionId: 'missing-grok-session' }),
      );
      const eventIndex = send.mock.calls.findIndex(([channel]) => channel === 'heteroAgentEvent');
      const errorIndex = send.mock.calls.findIndex(
        ([channel]) => channel === 'heteroAgentSessionError',
      );
      expect(eventIndex).toBeGreaterThanOrEqual(0);
      expect(errorIndex).toBeGreaterThan(eventIndex);
      expect(send).toHaveBeenCalledWith('heteroAgentSessionError', {
        error: {
          agentType: 'grok-build',
          code: HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound,
          command: 'grok',
          details: {
            code: -32_603,
            data: { code: 'FS_NOT_FOUND', detail: '/sessions/missing-grok-session' },
          },
          message:
            'The saved Grok Build session could not be found, so it can no longer be resumed.',
          resumeSessionId: 'missing-grok-session',
          stderr: missingSessionError.message,
          workingDirectory: '/Users/fake/projects/repo',
        },
        sessionId,
      });
      expect(send).not.toHaveBeenCalledWith('heteroAgentSessionComplete', { sessionId });
    });

    it('does not classify a non-load ACP filesystem error as a stale resume session', () => {
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const promptError = new AcpRpcResponseError('session/prompt', {
        code: -32_603,
        data: { code: 'FS_NOT_FOUND', detail: '/workspace/missing-file' },
        message: 'Path not found.',
      });

      const payload = (ctr as any).getSessionErrorPayload(promptError, {
        agentSessionId: 'grok-session',
        agentType: 'grok-build',
        args: [],
        command: 'grok',
        resumeSessionId: 'grok-session',
        sessionId: 'session-1',
      });

      expect(payload).toBe(promptError.message);
    });
  });

  describe('sendPrompt (kimi-code provider binding)', () => {
    let originalKimiBaseURL: string | undefined;

    beforeEach(() => {
      originalKimiBaseURL = process.env.KIMI_MODEL_BASE_URL;
      process.env.KIMI_MODEL_BASE_URL = 'https://stale-or-attacker.example/v1';
      spawnCalls.length = 0;
      execFileMock.mockReset();
      getProviderBindingRuntimeMock.mockResolvedValue({
        enabled: true,
        runtimeConfig: {
          config: {},
          keyVaults: {
            apiKey: 'kimi-provider-secret',
            baseURL: 'https://gateway.example.com/v1/',
          },
          settings: { sdkType: 'openai' },
        },
      });
    });

    afterEach(() => {
      if (originalKimiBaseURL === undefined) delete process.env.KIMI_MODEL_BASE_URL;
      else process.env.KIMI_MODEL_BASE_URL = originalKimiBaseURL;
    });

    it('requires Kimi Code 0.6.0 for provider binding but not subscription mode', async () => {
      const detect = vi.fn().mockResolvedValue({ available: true, version: '0.5.0' });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        binaryManager: { detect },
        storeManager: { get: vi.fn() },
      } as any);
      const providerSession = await ctr.startSession({
        agentType: 'kimi-code',
        command: 'kimi',
        providerBinding: {
          apiConfig: { model: 'upstream-model', providerId: 'custom-openai' },
          kind: 'provider',
        },
      });

      await expect(
        ctr.sendPrompt({
          operationId: 'op-kimi-old-provider',
          prompt: 'provider prompt',
          sessionId: providerSession.sessionId,
        }),
      ).rejects.toThrow(
        'Kimi Code 0.6.0 or newer is required to use a LobeHub provider. Installed version: 0.5.0.',
      );
      expect(spawnCalls).toHaveLength(0);

      nextFakeProc = createFakeProc().proc;
      const subscriptionSession = await ctr.startSession({
        agentType: 'kimi-code',
        command: 'kimi',
      });
      await ctr.sendPrompt({
        operationId: 'op-kimi-old-subscription',
        prompt: 'subscription prompt',
        sessionId: subscriptionSession.sessionId,
      });

      expect(spawnCalls).toHaveLength(1);
    });

    it('keeps the env-only binding across fresh and resumed runs without persisting the key', async () => {
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const providerBinding = {
        apiConfig: { model: 'upstream-model', providerId: 'custom-openai' },
        kind: 'provider' as const,
      };

      nextFakeProc = createFakeProc().proc;
      const fresh = await ctr.startSession({
        agentType: 'kimi-code',
        args: [
          '--continue',
          '-c',
          '-C',
          '--model',
          'stale-model',
          '--session=stale-session',
          '--verbose',
        ],
        command: 'kimi',
        env: {
          KIMI_CODE_HOME: '/user/kimi',
          KIMI_MODEL_API_KEY: 'stale-key',
          KIMI_MODEL_BASE_URL: 'https://stale.example.com',
        },
        providerBinding,
      });
      await ctr.sendPrompt({
        operationId: 'op-kimi-fresh',
        prompt: 'fresh private prompt',
        sessionId: fresh.sessionId,
      });

      expect(spawnCalls[0].args).toEqual([
        '--output-format',
        'stream-json',
        '--verbose',
        '--prompt',
        'fresh private prompt',
      ]);
      expect(spawnCalls[0].options.env).toEqual(
        expect.objectContaining({
          KIMI_CODE_HOME: expect.stringContaining('/heteroAgent/bindings/kimi-code/'),
          KIMI_MODEL_API_KEY: expect.any(String),
          KIMI_MODEL_BASE_URL: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/v1$/),
          KIMI_MODEL_NAME: 'upstream-model',
          KIMI_MODEL_PROVIDER_TYPE: 'openai',
          NO_PROXY: expect.stringContaining('127.0.0.1'),
          no_proxy: expect.stringContaining('127.0.0.1'),
        }),
      );

      nextFakeProc = createFakeProc().proc;
      const resumed = await ctr.startSession({
        agentType: 'kimi-code',
        command: 'kimi',
        providerBinding: { ...providerBinding, resumeBindingKey: fresh.providerBindingKey },
        resumeSessionId: 'kimi-native-session',
      });
      await ctr.sendPrompt({
        operationId: 'op-kimi-resume',
        prompt: 'resume private prompt',
        sessionId: resumed.sessionId,
      });

      expect(spawnCalls[1].args).toEqual([
        '--output-format',
        'stream-json',
        '--session',
        'kimi-native-session',
        '--prompt',
        'resume private prompt',
      ]);
      expect(spawnCalls[1].options.env).toEqual(
        expect.objectContaining({
          KIMI_MODEL_API_KEY: expect.any(String),
          KIMI_MODEL_BASE_URL: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/v1$/),
          KIMI_MODEL_NAME: 'upstream-model',
          KIMI_MODEL_PROVIDER_TYPE: 'openai',
        }),
      );
      expect(spawnCalls[0].options.env.KIMI_MODEL_API_KEY).not.toBe('kimi-provider-secret');
      expect(spawnCalls[1].options.env.KIMI_MODEL_API_KEY).not.toBe('kimi-provider-secret');
      expect(spawnCalls.flatMap(({ args }) => args)).not.toContain('kimi-provider-secret');
      expect(JSON.stringify(spawnCalls)).not.toContain('kimi-provider-secret');
      expect(JSON.stringify(spawnCalls)).not.toContain('stale-or-attacker.example');
      expect(JSON.stringify(loggerInfoMock.mock.calls)).not.toContain('kimi-provider-secret');

      const bindingsRoot = path.join(appStoragePath, 'heteroAgent', 'bindings', 'kimi-code');
      const [bindingDir] = await readdir(bindingsRoot);
      const profileFiles = await readdir(path.join(bindingsRoot, bindingDir));
      expect(profileFiles).toEqual(['.lobehub-last-used']);
      expect(
        await readFile(path.join(bindingsRoot, bindingDir, '.lobehub-last-used'), 'utf8'),
      ).not.toContain('kimi-provider-secret');
    });
  });

  describe('sendPrompt (codex)', () => {
    beforeEach(() => {
      spawnCalls.length = 0;
      execFileMock.mockReset();
    });

    const runSendPrompt = async (
      prompt: string,
      sessionOverrides: Record<string, any> = {},
      stdoutLines: string[] = [],
      sendPromptOverrides: Partial<{
        imageList: Array<{ id: string; url: string }>;
        systemContext: string;
      }> = {},
      storeGet?: (key: string, defaultValue?: any) => any,
    ) => {
      const { proc, writes } = createFakeProc({ stdoutLines });
      nextFakeProc = proc;

      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: storeGet ? vi.fn(storeGet) : vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        ...sessionOverrides,
      });
      await ctr.sendPrompt({ operationId: 'op-test', prompt, sessionId, ...sendPromptOverrides });

      const { args: cliArgs, command, options } = spawnCalls[0];
      return { cliArgs, command, ctr, options, sessionId, writes };
    };

    it('identifies Codex when beginning a server-default operation', async () => {
      const { proc } = createFakeProc();
      nextFakeProc = proc;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        providerBinding: {
          apiConfig: { model: 'gpt-5.4', source: 'server-default' },
          kind: 'server-default',
        },
      });

      await ctr.sendPrompt({
        agentId: 'agent-1',
        operationId: 'op-server-default',
        prompt: 'hello',
        sessionId,
        topicId: 'topic-1',
      });

      expect(beginServerDefaultOperationMock).toHaveBeenCalledWith(expect.any(Object), {
        agentId: 'agent-1',
        agentType: 'codex',
        model: 'gpt-5.4',
        operationId: 'op-server-default',
        topicId: 'topic-1',
      });
      expect(spawnCalls[0].args).toEqual(expect.arrayContaining(['--model', 'lobehub/gpt-5.4']));
      expect(spawnCalls[0].options.env.LOBEHUB_HETERO_TOKEN).toBe('operation-token');
      expect(settleServerDefaultOperationMock).toHaveBeenCalledWith(expect.any(Object), {
        cancelled: false,
        operationId: 'op-server-default',
        result: 'done',
      });
    });

    it('injects a Kimi operation token into its Anthropic credential env', async () => {
      nextFakeProc = createFakeProc().proc;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'kimi-code',
        command: 'kimi',
        providerBinding: {
          apiConfig: { model: 'kimi-k2.6', source: 'server-default' },
          kind: 'server-default',
        },
      });

      await ctr.sendPrompt({
        operationId: 'op-server-default-kimi',
        prompt: 'hello',
        sessionId,
        topicId: 'topic-1',
      });

      expect(beginServerDefaultOperationMock).toHaveBeenCalledWith(expect.any(Object), {
        agentId: undefined,
        agentType: 'kimi-code',
        model: 'kimi-k2.6',
        operationId: 'op-server-default-kimi',
        topicId: 'topic-1',
      });
      expect(spawnCalls[0]).toMatchObject({
        command: 'kimi',
        options: {
          env: {
            KIMI_MODEL_API_KEY: 'operation-token',
            KIMI_MODEL_BASE_URL: 'https://app.example.com/api/v1/anthropic',
            KIMI_MODEL_NAME: 'lobehub/kimi-k2.6',
            KIMI_MODEL_PROVIDER_TYPE: 'anthropic',
          },
        },
      });
      expect(settleServerDefaultOperationMock).toHaveBeenCalledWith(expect.any(Object), {
        cancelled: false,
        operationId: 'op-server-default-kimi',
        result: 'done',
      });
    });

    it('injects a Pi operation token into its Responses credential env', async () => {
      nextFakeProc = createFakeProc().proc;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'pi',
        command: 'pi',
        providerBinding: {
          apiConfig: { model: 'kimi-k2.6', source: 'server-default' },
          kind: 'server-default',
        },
      });

      await ctr.sendPrompt({
        operationId: 'op-server-default-pi',
        prompt: 'hello',
        sessionId,
        topicId: 'topic-1',
      });

      expect(beginServerDefaultOperationMock).toHaveBeenCalledWith(expect.any(Object), {
        agentId: undefined,
        agentType: 'pi',
        model: 'kimi-k2.6',
        operationId: 'op-server-default-pi',
        topicId: 'topic-1',
      });
      expect(spawnCalls[0].args).toEqual(
        expect.arrayContaining([
          '--provider',
          'lobehub-server-default',
          '--model',
          'lobehub/kimi-k2.6',
        ]),
      );
      expect(spawnCalls[0].options.env.LOBEHUB_PI_API_KEY).toBe('operation-token');
      expect(settleServerDefaultOperationMock).toHaveBeenCalledWith(expect.any(Object), {
        cancelled: false,
        operationId: 'op-server-default-pi',
        result: 'done',
      });
    });

    it('does not launch server-default Codex when cancelled while authorization is pending', async () => {
      let resolveBegin!: (value: {
        endpoint: string;
        model: 'lobehub-default';
        token: string;
      }) => void;
      beginServerDefaultOperationMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveBegin = resolve;
          }),
      );
      nextFakeProc = createFakeProc().proc;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        providerBinding: {
          apiConfig: { model: 'gpt-5.4', source: 'server-default' },
          kind: 'server-default',
        },
      });

      const sendPrompt = ctr.sendPrompt({
        agentId: 'agent-1',
        operationId: 'op-cancel-authorization',
        prompt: 'hello',
        sessionId,
        topicId: 'topic-1',
      });
      await vi.waitFor(() => expect(beginServerDefaultOperationMock).toHaveBeenCalledOnce());

      await ctr.cancelSession({ sessionId });
      resolveBegin({
        endpoint: 'https://app.example.com',
        model: 'lobehub-default',
        token: 'operation-token',
      });
      await sendPrompt;

      expect(spawnCalls).toHaveLength(0);
      expect(settleServerDefaultOperationMock).toHaveBeenCalledWith(expect.any(Object), {
        cancelled: true,
        operationId: 'op-cancel-authorization',
        result: 'error',
      });
    });

    it('does not launch server-default Codex when cancelled during spawn preparation', async () => {
      nextFakeProc = createFakeProc().proc;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        providerBinding: {
          apiConfig: { model: 'gpt-5.4', source: 'server-default' },
          kind: 'server-default',
        },
      });
      let completePreparation!: () => void;
      const createTraceSession = vi
        .spyOn(ctr as any, 'createCliTraceSession')
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              completePreparation = resolve;
            }),
        );

      const sendPrompt = ctr.sendPrompt({
        agentId: 'agent-1',
        operationId: 'op-cancel-preflight',
        prompt: 'hello',
        sessionId,
        topicId: 'topic-1',
      });
      await vi.waitFor(() => expect(createTraceSession).toHaveBeenCalledOnce());

      await ctr.cancelSession({ sessionId });
      completePreparation();
      await sendPrompt;

      expect(spawnCalls).toHaveLength(0);
      expect(settleServerDefaultOperationMock).toHaveBeenCalledWith(expect.any(Object), {
        cancelled: true,
        operationId: 'op-cancel-preflight',
        result: 'error',
      });
    });

    it('fails fast when Codex CLI is unavailable instead of attempting spawn', async () => {
      const detect = vi.fn().mockResolvedValue({ available: false });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
        binaryManager: { detect },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
      });

      await expect(
        ctr.sendPrompt({ operationId: 'op-test', prompt: 'hello', sessionId }),
      ).rejects.toThrow('Codex CLI was not found');

      expect(detect).toHaveBeenCalledWith('codex');
      expect(spawnCalls).toHaveLength(0);
    });

    it('rejects a binding whose model the server reports as disabled, even when the renderer sent it', async () => {
      getProviderBindingRuntimeMock.mockResolvedValue({
        enabled: true,
        enabledModels: [{ id: 'another-model', providerId: 'openai', type: 'chat' }],
        runtimeConfig: {
          config: { enableResponseApi: true },
          keyVaults: { apiKey: 'provider-secret' },
          settings: { sdkType: 'openai', supportResponsesApi: true },
        },
      });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);

      await expect(
        ctr.startSession({
          agentType: 'codex',
          command: 'codex',
          providerBinding: {
            apiConfig: { model: 'gpt-test', providerId: 'openai' },
            kind: 'provider',
          },
        }),
      ).rejects.toThrow('Model "openai/gpt-test" is disabled or unavailable.');
    });

    it('cleans provider-binding run state when CLI preflight fails', async () => {
      const detect = vi.fn().mockResolvedValue({ available: false });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        binaryManager: { detect },
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        providerBinding: {
          apiConfig: { model: 'gpt-test', providerId: 'openai' },
          kind: 'provider',
        },
      });
      const runsDir = path.join(appStoragePath, 'heteroAgent', 'runs');
      expect(await readdir(runsDir)).toEqual([sessionId]);

      await expect(
        ctr.sendPrompt({ operationId: 'op-test', prompt: 'hello', sessionId }),
      ).rejects.toThrow('Codex CLI was not found');

      expect(await readdir(runsDir)).toEqual([]);
    });

    it('forces provider-bound Codex through exec without persisting or logging its secret', async () => {
      const { cliArgs, options, sessionId } = await runSendPrompt('provider-bound prompt', {
        providerBinding: {
          apiConfig: { model: 'gpt-test', providerId: 'openai' },
          kind: 'provider',
        },
        useCodexAppServer: true,
      });

      expect(cliArgs[0]).toBe('exec');
      expect(codexAppServerConstructMock).not.toHaveBeenCalled();
      expect(options.env).toEqual(
        expect.objectContaining({
          CODEX_HOME: expect.stringContaining('/heteroAgent/bindings/codex/'),
          LOBEHUB_CODEX_API_KEY: 'provider-secret',
        }),
      );
      expect(JSON.stringify(cliArgs)).not.toContain('provider-secret');
      expect(JSON.stringify(loggerInfoMock.mock.calls)).not.toContain('provider-secret');

      const codexBindingsDir = path.join(appStoragePath, 'heteroAgent', 'bindings', 'codex');
      const [bindingDir] = await readdir(codexBindingsDir);
      const config = await readFile(path.join(codexBindingsDir, bindingDir, 'config.toml'), 'utf8');
      expect(config).toContain('wire_api = "responses"');
      expect(config).not.toContain('provider-secret');
      await expect(
        readdir(path.join(appStoragePath, 'heteroAgent', 'runs', sessionId)),
      ).rejects.toThrow();
    });

    it('cleans provider-binding run state when spawn throws synchronously', async () => {
      nextFakeProc = {
        __start: () => {
          throw new Error('spawn failed');
        },
      };
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        providerBinding: {
          apiConfig: { model: 'gpt-test', providerId: 'openai' },
          kind: 'provider',
        },
      });

      await expect(
        ctr.sendPrompt({ operationId: 'op-test', prompt: 'hello', sessionId }),
      ).rejects.toThrow('spawn failed');
      await expect(
        readdir(path.join(appStoragePath, 'heteroAgent', 'runs', sessionId)),
      ).rejects.toThrow();
    });

    it('resumes a provider-bound session only when the resolved binding key matches', async () => {
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const first = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        providerBinding: {
          apiConfig: { model: 'gpt-test', providerId: 'openai' },
          kind: 'provider',
        },
      });
      const legacy = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        providerBinding: {
          apiConfig: { model: 'gpt-test', providerId: 'openai' },
          kind: 'provider',
        },
        resumeSessionId: 'thread-without-binding-key',
      });
      const rejected = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        providerBinding: {
          apiConfig: { model: 'gpt-test', providerId: 'openai' },
          kind: 'provider',
          resumeBindingKey: 'provider-binding:v1:different',
        },
        resumeSessionId: 'thread-rejected',
      });
      const accepted = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        providerBinding: {
          apiConfig: { model: 'gpt-test', providerId: 'openai' },
          kind: 'provider',
          resumeBindingKey: first.providerBindingKey,
        },
        resumeSessionId: 'thread-accepted',
      });

      await expect(ctr.getSessionInfo({ sessionId: legacy.sessionId })).resolves.toEqual({
        agentSessionId: undefined,
      });
      await expect(ctr.getSessionInfo({ sessionId: rejected.sessionId })).resolves.toEqual({
        agentSessionId: undefined,
      });
      await expect(ctr.getSessionInfo({ sessionId: accepted.sessionId })).resolves.toEqual({
        agentSessionId: 'thread-accepted',
      });
      expect(accepted.providerBindingKey).toBe(first.providerBindingKey);
    });

    it('validates the default desktop directory when the session cwd is omitted', async () => {
      vi.mocked(statSync).mockImplementation((candidate) =>
        candidate === FAKE_DESKTOP_PATH ? asDirectory : (undefined as never),
      );
      const detect = vi.fn().mockResolvedValue({ available: false });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
        binaryManager: { detect },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
      });

      await expect(
        ctr.sendPrompt({ operationId: 'op-test', prompt: 'hello', sessionId }),
      ).rejects.toThrow('Codex CLI was not found');

      expect(statSync).toHaveBeenCalledWith(FAKE_DESKTOP_PATH, expect.anything());
      expect(detect).toHaveBeenCalledWith('codex');
    });

    it('reports a missing working directory instead of claiming the Codex CLI is missing', async () => {
      const missingCwd = '/tmp/lobehub-deleted-worktree';
      mockMissingDir(missingCwd);
      const detect = vi.fn().mockResolvedValue({
        available: true,
        path: '/Applications/ChatGPT.app/Contents/Resources/codex',
      });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
        binaryManager: { detect },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        cwd: missingCwd,
      });

      await expect(
        ctr.sendPrompt({ operationId: 'op-test', prompt: 'hello', sessionId }),
      ).rejects.toThrow(`Working directory does not exist: ${missingCwd}`);

      expect(detect).not.toHaveBeenCalled();
      expect(spawnCalls).toHaveLength(0);
    });

    it('fails fast when Claude Code CLI is unavailable instead of attempting spawn', async () => {
      const detect = vi.fn().mockResolvedValue({ available: false });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
        binaryManager: { detect },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'claude-code',
        command: 'claude',
      });

      await expect(
        ctr.sendPrompt({ operationId: 'op-test', prompt: 'hello', sessionId }),
      ).rejects.toThrow('Claude Code CLI was not found');

      expect(detect).toHaveBeenCalledWith('claude');
      expect(spawnCalls).toHaveLength(0);
    });

    it('fails fast with CodeBuddy install guidance when CodeBuddy is unavailable', async () => {
      const detect = vi.fn().mockResolvedValue({ available: false });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
        binaryManager: { detect },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codebuddy',
        command: 'codebuddy',
      });

      await expect(
        ctr.sendPrompt({ operationId: 'op-test', prompt: 'hello', sessionId }),
      ).rejects.toThrow('CodeBuddy CLI was not found');

      expect(detect).toHaveBeenCalledWith('codebuddy');
      expect(spawnCalls).toHaveLength(0);
    });

    it('fails fast with AMP-specific install guidance when AMP is unavailable', async () => {
      const detect = vi.fn().mockResolvedValue({ available: false });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
        binaryManager: { detect },
      } as any);
      const { sessionId } = await ctr.startSession({ agentType: 'amp', command: 'amp' });

      await expect(
        ctr.sendPrompt({ operationId: 'op-test', prompt: 'hello', sessionId }),
      ).rejects.toThrow('Amp CLI was not found');

      expect(detect).toHaveBeenCalledWith('amp');
      expect(spawnCalls).toHaveLength(0);
    });

    it('fails fast with OpenCode install guidance when OpenCode is unavailable', async () => {
      const detect = vi.fn().mockResolvedValue({ available: false });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
        binaryManager: { detect },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'opencode',
        command: 'opencode',
      });

      await expect(
        ctr.sendPrompt({ operationId: 'op-test', prompt: 'hello', sessionId }),
      ).rejects.toThrow('OpenCode CLI was not found');

      expect(detect).toHaveBeenCalledWith('opencode');
      expect(spawnCalls).toHaveLength(0);
    });

    it('fails fast when a customized Claude command is unavailable instead of checking the default detector', async () => {
      execFileMock.mockImplementation(
        (
          file: string,
          _args: string[],
          optionsOrCallback: unknown,
          callback?: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          const resolvedCallback =
            typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;

          resolvedCallback?.(
            Object.assign(new Error(`${file} not found`), { code: 'ENOENT' }),
            '',
            '',
          );
        },
      );

      const detect = vi.fn().mockResolvedValue({ available: true });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
        binaryManager: { detect },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'claude-code',
        command: 'claude-alt',
      });

      await expect(
        ctr.sendPrompt({ operationId: 'op-test', prompt: 'hello', sessionId }),
      ).rejects.toThrow('Claude Code CLI was not found');

      expect(detect).not.toHaveBeenCalled();
      expect(spawnCalls).toHaveLength(0);
    });

    it('spawns through the detector-resolved absolute path when the bare command is off PATH', async () => {
      // Codex desktop app case: `codex` is not on PATH, but the preflight
      // detector finds the CLI bundled inside ChatGPT.app. Spawning the bare
      // command would ENOENT — spawn must use the resolved absolute path.
      const resolvedPath = '/Applications/ChatGPT.app/Contents/Resources/codex';
      const detect = vi.fn().mockResolvedValue({ available: true, path: resolvedPath });
      const { proc } = createFakeProc();
      nextFakeProc = proc;

      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
        binaryManager: { detect },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
      });
      await ctr.sendPrompt({ operationId: 'op-test', prompt: 'hello', sessionId });

      expect(spawnCalls[0].command).toBe(resolvedPath);
    });

    it('carries the detector login-shell PATH into the spawn env for `env node` shims', async () => {
      // `codex` resolved via the login-shell PATH (mise/nvm). Spawning the
      // absolute shim under the leaner inherited PATH would fail at its
      // `#!/usr/bin/env node` shebang — the resolved PATH must reach the child.
      const resolvedPath = '/Users/h/.local/share/mise/shims/codex';
      const searchPath = '/Users/h/.local/share/mise/shims:/usr/bin:/bin';
      const detect = vi
        .fn()
        .mockResolvedValue({ available: true, path: resolvedPath, resolvedPathEnv: searchPath });
      const { proc } = createFakeProc();
      nextFakeProc = proc;

      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
        binaryManager: { detect },
      } as any);
      const { sessionId } = await ctr.startSession({ agentType: 'codex', command: 'codex' });
      await ctr.sendPrompt({ operationId: 'op-test', prompt: 'hello', sessionId });

      expect(spawnCalls[0].command).toBe(resolvedPath);
      expect(spawnCalls[0].options.env.PATH).toBe(searchPath);
    });

    it('keeps an explicit path-like command for spawn instead of the detector result', async () => {
      // detectHeterogeneousCliCommand validates the custom path via --version.
      execFileMock.mockImplementation(
        (
          _file: string,
          _args: string[],
          optionsOrCallback: unknown,
          callback?: (error: Error | null, result: { stderr: string; stdout: string }) => void,
        ) => {
          const resolvedCallback =
            typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
          (resolvedCallback as any)?.(null, { stderr: '', stdout: 'codex-cli 0.99.0' });
        },
      );

      const detect = vi.fn();
      const { proc } = createFakeProc();
      nextFakeProc = proc;

      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
        binaryManager: { detect },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: '/custom/bin/codex',
      });
      await ctr.sendPrompt({ operationId: 'op-test', prompt: 'hello', sessionId });

      expect(detect).not.toHaveBeenCalled();
      expect(spawnCalls[0].command).toBe('/custom/bin/codex');
    });

    it('passes prompt via stdin to codex exec instead of argv', async () => {
      const prompt = '--run a shell-like prompt safely';
      const { cliArgs, command, writes } = await runSendPrompt(prompt);

      expect(command).toBe('codex');
      expect(cliArgs).not.toContain(prompt);
      expect(cliArgs).toEqual(
        expect.arrayContaining([
          'exec',
          '--json',
          '--skip-git-repo-check',
          '--dangerously-bypass-approvals-and-sandbox',
        ]),
      );
      expect(cliArgs).not.toContain('--full-auto');
      expect(cliArgs).not.toContain('-');
      expect(writes).toEqual([prompt]);
    });

    it('uses Codex app-server lab instead of spawning codex exec', async () => {
      const send = vi.fn();
      mockGetAllWindows.mockReturnValue([
        {
          isDestroyed: () => false,
          webContents: { send },
        },
      ]);
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        args: ['--model', 'gpt-5.5-codex'],
        command: 'codex',
        useCodexAppServer: true,
      });

      await ctr.sendPrompt({ operationId: 'op-test', prompt: 'stream this', sessionId });

      expect(spawnCalls).toHaveLength(0);
      expect(codexAppServerClientConstructMock).toHaveBeenCalledWith(
        expect.objectContaining({
          args: [],
          clientVersion: '1.0.0-test',
          commandPath: 'codex',
          cwd: FAKE_DESKTOP_PATH,
        }),
      );
      expect(codexAppServerConstructMock).toHaveBeenCalledWith(
        expect.objectContaining({
          threadName: 'stream this',
          threadParams: expect.objectContaining({
            cwd: FAKE_DESKTOP_PATH,
            model: 'gpt-5.5-codex',
          }),
        }),
      );
      expect(codexAppServerRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          input: [{ text: 'stream this', text_elements: [], type: 'text' }],
          operationId: 'op-test',
        }),
      );
      await expect(ctr.getSessionInfo({ sessionId })).resolves.toEqual({
        agentSessionId: 'thread_app_server',
      });
      expect(send).toHaveBeenCalledWith('heteroAgentSessionComplete', { sessionId });
    });

    it('reuses one native app-server client for multiple new Codex sessions', async () => {
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const first = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        useCodexAppServer: true,
      });
      const second = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        useCodexAppServer: true,
      });

      await ctr.sendPrompt({ operationId: 'op-1', prompt: 'first', sessionId: first.sessionId });
      await ctr.sendPrompt({ operationId: 'op-2', prompt: 'second', sessionId: second.sessionId });

      expect(codexAppServerClientConstructMock).toHaveBeenCalledTimes(1);
      expect(codexAppServerConstructMock).toHaveBeenCalledTimes(2);
    });

    it('reuses one native thread session across multiple turns', async () => {
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        useCodexAppServer: true,
      });

      await ctr.sendPrompt({ operationId: 'op-1', prompt: 'first', sessionId });
      await ctr.sendPrompt({ operationId: 'op-2', prompt: 'second', sessionId });

      expect(codexAppServerClientConstructMock).toHaveBeenCalledTimes(1);
      expect(codexAppServerConstructMock).toHaveBeenCalledTimes(1);
      expect(codexAppServerRunMock.mock.calls.map(([options]) => options.operationId)).toEqual([
        'op-1',
        'op-2',
      ]);
    });

    it('does not switch to exec when the shared native client is incompatible', async () => {
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const first = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        useCodexAppServer: true,
      });
      const second = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        useCodexAppServer: true,
      });
      await ctr.sendPrompt({ operationId: 'op-1', prompt: 'first', sessionId: first.sessionId });

      codexAppServerCanReuse.value = false;
      await expect(
        ctr.sendPrompt({ operationId: 'op-2', prompt: 'second', sessionId: second.sessionId }),
      ).rejects.toThrow('different binary, global configuration, or environment');

      expect(codexAppServerClientConstructMock).toHaveBeenCalledTimes(1);
      expect(codexAppServerConstructMock).toHaveBeenCalledTimes(1);
      expect(spawnCalls).toHaveLength(0);
    });

    it('replaces an incompatible shared client after its last thread session closes', async () => {
      codexAppServerShouldFailAfterThread.value = true;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const first = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        useCodexAppServer: true,
      });
      await expect(
        ctr.sendPrompt({ operationId: 'op-1', prompt: 'fail', sessionId: first.sessionId }),
      ).rejects.toThrow('Codex app-server disconnected');
      expect(codexAppServerConsumerCount.value).toBe(0);

      codexAppServerShouldFailAfterThread.value = false;
      codexAppServerCanReuse.value = false;
      const second = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        useCodexAppServer: true,
      });
      await ctr.sendPrompt({ operationId: 'op-2', prompt: 'retry', sessionId: second.sessionId });

      expect(codexAppServerClientCloseMock).toHaveBeenCalledOnce();
      expect(codexAppServerClientConstructMock).toHaveBeenCalledTimes(2);
      expect(codexAppServerConstructMock).toHaveBeenCalledTimes(2);
    });

    it.each([
      { args: ['--profile', 'work'], label: 'profile' },
      { args: ['-a', 'on-request'], label: 'interactive approval policy' },
    ])('keeps unsupported Codex $label arguments on exec', async ({ args }) => {
      const { proc } = createFakeProc();
      nextFakeProc = proc;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        args,
        command: 'codex',
        useCodexAppServer: true,
      });

      await ctr.sendPrompt({ operationId: 'op-test', prompt: 'preserve CLI semantics', sessionId });

      expect(codexAppServerClientConstructMock).not.toHaveBeenCalled();
      expect(codexAppServerConstructMock).not.toHaveBeenCalled();
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0].args).toEqual(expect.arrayContaining(args));
    });

    it('does not replay an existing thread through exec when its arguments are unsupported', async () => {
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        args: ['--profile', 'work'],
        command: 'codex',
        resumeSessionId: 'thread-existing',
        useCodexAppServer: true,
      });

      await expect(
        ctr.sendPrompt({ operationId: 'op-test', prompt: 'preserve CLI semantics', sessionId }),
      ).rejects.toThrow('cannot safely resume this session');

      expect(codexAppServerClientConstructMock).not.toHaveBeenCalled();
      expect(codexAppServerConstructMock).not.toHaveBeenCalled();
      expect(spawnCalls).toHaveLength(0);
    });

    it('falls back to codex exec when the native handshake is incompatible', async () => {
      const send = vi.fn();
      mockGetAllWindows.mockReturnValue([
        {
          isDestroyed: () => false,
          webContents: { send },
        },
      ]);
      const { proc } = createFakeProc();
      nextFakeProc = proc;
      codexAppServerShouldFallback.value = true;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        useCodexAppServer: true,
      });

      await ctr.sendPrompt({ operationId: 'op-test', prompt: 'fallback safely', sessionId });

      expect(codexAppServerClientConstructMock).toHaveBeenCalledTimes(1);
      expect(codexAppServerClientCloseMock).toHaveBeenCalledTimes(1);
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0].args).toEqual(expect.arrayContaining(['exec', '--json']));
      expect(send).toHaveBeenCalledWith('heteroAgentEvent', {
        event: expect.objectContaining({
          data: expect.objectContaining({ message: expect.stringContaining('Upgrade Codex') }),
          operationId: 'op-test',
          type: 'stream_retry',
        }),
        sessionId,
      });

      codexAppServerShouldFallback.value = false;
      const { proc: retryProc } = createFakeProc();
      nextFakeProc = retryProc;
      await ctr.sendPrompt({ operationId: 'op-retry', prompt: 'stay on exec', sessionId });

      expect(codexAppServerClientConstructMock).toHaveBeenCalledTimes(1);
      expect(spawnCalls).toHaveLength(2);
    });

    it('does not fall back to exec after the native thread is established', async () => {
      codexAppServerShouldFailAfterThread.value = true;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        useCodexAppServer: true,
      });

      await expect(
        ctr.sendPrompt({ operationId: 'op-test', prompt: 'do not replay', sessionId }),
      ).rejects.toThrow('Codex app-server disconnected');

      expect(codexAppServerClientCloseMock).not.toHaveBeenCalled();
      expect(codexAppServerCloseMock).toHaveBeenCalledOnce();
      expect(spawnCalls).toHaveLength(0);

      codexAppServerShouldFailAfterThread.value = false;
      await ctr.sendPrompt({ operationId: 'op-retry', prompt: 'resume natively', sessionId });
      expect(codexAppServerConstructMock).toHaveBeenCalledTimes(2);
    });

    it('clears a closed native thread session after a genuine interrupt failure', async () => {
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        useCodexAppServer: true,
      });
      await ctr.sendPrompt({ operationId: 'op-1', prompt: 'first', sessionId });
      codexAppServerInterruptMock.mockRejectedValueOnce(new Error('Interrupt rejected'));

      await ctr.cancelSession({ sessionId });
      await ctr.sendPrompt({ operationId: 'op-2', prompt: 'continue', sessionId });

      expect(codexAppServerCloseMock).toHaveBeenCalledOnce();
      expect(codexAppServerConstructMock).toHaveBeenCalledTimes(2);
      expect(codexAppServerClientConstructMock).toHaveBeenCalledOnce();
    });

    it('resumes existing Codex threads through native app-server', async () => {
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        resumeSessionId: 'thread-existing',
        useCodexAppServer: true,
      });

      await ctr.sendPrompt({ operationId: 'op-test', prompt: 'continue', sessionId });

      expect(codexAppServerConstructMock).toHaveBeenCalledWith(
        expect.objectContaining({ initialThreadId: 'thread-existing' }),
      );
      expect(codexAppServerRunMock).toHaveBeenCalledTimes(1);
      expect(spawnCalls).toHaveLength(0);
    });

    it('does not replay an existing Codex thread through exec when thread/resume fails', async () => {
      codexAppServerShouldFailResume.value = true;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        resumeSessionId: 'thread-existing',
        useCodexAppServer: true,
      });

      await expect(
        ctr.sendPrompt({ operationId: 'op-test', prompt: 'continue', sessionId }),
      ).rejects.toThrow('saved Codex thread could not be found');

      expect(codexAppServerRunMock).toHaveBeenCalledTimes(1);
      expect(codexAppServerClientCloseMock).not.toHaveBeenCalled();
      expect(spawnCalls).toHaveLength(0);
    });

    it('places system context before the user prompt in codex stdin', async () => {
      const { writes } = await runSendPrompt('user task', {}, [], {
        systemContext: 'selected code context',
      });

      expect(writes).toEqual(['selected code context\n\nuser task']);
    });

    it('materializes image attachments into local files and forwards them via --image', async () => {
      const imageList = [
        { id: 'image-1', url: 'data:image/png;base64,UE5HX1RFU1Q=' },
        { id: 'image-2', url: 'data:image/jpeg;base64,SlBFR19URVNU' },
      ];
      const { cliArgs, writes } = await runSendPrompt('describe these screenshots', {}, [], {
        imageList,
      });

      const imagePaths = getFlagValues(cliArgs, '--image');

      expect(cliArgs).not.toContain('describe these screenshots');
      expect(cliArgs).not.toContain('-');
      expect(cliArgs.filter((arg) => arg === '--image')).toHaveLength(2);
      expect(imagePaths).toHaveLength(2);
      expect(imagePaths).not.toContain('-');
      expect(cliArgs.at(-1)).toBe(imagePaths[1]);
      expect(imagePaths[0]).toMatch(/\.png$/);
      expect(imagePaths[1]).toMatch(/\.jpg$/);
      expect(
        imagePaths.every((filePath) =>
          filePath.startsWith(path.join(appStoragePath, 'heteroAgent/files')),
        ),
      ).toBe(true);
      await expect(
        Promise.all(imagePaths.map((filePath) => readFile(filePath, 'utf8'))),
      ).resolves.toEqual(['PNG_TEST', 'JPEG_TEST']);
      expect(writes).toEqual(['describe these screenshots']);
    });

    it('normalizes parameterized image MIME types before choosing the CLI file extension', async () => {
      const imageList = [
        { id: 'image-with-params', url: 'data:image/png;charset=utf-8;base64,UE5HX1RFU1Q=' },
      ];
      const { cliArgs } = await runSendPrompt('describe this screenshot', {}, [], { imageList });

      const imagePaths = getFlagValues(cliArgs, '--image');

      expect(imagePaths).toHaveLength(1);
      expect(imagePaths[0]).toMatch(/\.png$/);
      await expect(readFile(imagePaths[0], 'utf8')).resolves.toBe('PNG_TEST');
    });

    it('sniffs image bytes when MIME and URL do not expose a usable extension', async () => {
      const pngBytes = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from('PNG_TEST'),
      ]);
      const imageList = [
        {
          id: 'image-octet',
          url: `data:application/octet-stream;base64,${pngBytes.toString('base64')}`,
        },
      ];
      const { cliArgs } = await runSendPrompt('describe this screenshot', {}, [], { imageList });

      const imagePaths = getFlagValues(cliArgs, '--image');

      expect(imagePaths).toHaveLength(1);
      expect(imagePaths[0]).toMatch(/\.png$/);
      await expect(readFile(imagePaths[0])).resolves.toEqual(pngBytes);
    });

    it('fails before spawning Codex when any image cannot be materialized', async () => {
      const imageList = [
        { id: 'good-image', url: 'data:image/png;base64,VkFMSURfSU1BR0U=' },
        { id: 'bad-image', url: 'bad://broken-image' },
      ];
      const { proc } = createFakeProc();
      nextFakeProc = proc;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
      });

      await expect(
        ctr.sendPrompt({
          imageList,
          operationId: 'op-test',
          prompt: 'inspect the screenshots',
          sessionId,
        }),
      ).rejects.toThrow('Failed to attach image(s) to CLI');
      expect(spawnCalls).toHaveLength(0);
    });

    it('does not surface Codex stderr status and warn logs as the terminal error', async () => {
      const { proc } = createFakeProc({
        exitCode: 1,
        stderrLines: [
          'Reading prompt from stdin...\n',
          '2026-04-25T09:24:08.165782Z  WARN codex_core::session_startup_prewarm: startup websocket prewarm setup failed\n',
          '<html>\n',
          '  <body>challenge page</body>\n',
          '</html>\n',
        ],
        stdoutLines: [
          `${JSON.stringify({ thread_id: 'thread_codex_123', type: 'thread.started' })}\n`,
          `${JSON.stringify({ type: 'turn.started' })}\n`,
          `${JSON.stringify({ message: 'real Codex JSONL error', type: 'error' })}\n`,
        ],
      });
      nextFakeProc = proc;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
      });

      await expect(
        ctr.sendPrompt({ operationId: 'op-test', prompt: 'hello', sessionId }),
      ).rejects.toThrow('Agent exited with code 1');
    });

    it('uses codex exec resume syntax when continuing an existing thread', async () => {
      const { cliArgs } = await runSendPrompt('continue', { resumeSessionId: 'thread_abc' });

      expect(cliArgs.slice(0, 2)).toEqual(['exec', 'resume']);
      expect(cliArgs).toContain('thread_abc');
      expect(cliArgs).not.toContain('--resume');
      expect(cliArgs.at(-2)).toBe('thread_abc');
      expect(cliArgs.at(-1)).toBe('-');
    });

    it('writes raw CLI streams to a dev trace directory grouped by agent type', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      try {
        const prompt = 'trace this run';
        const rawLine = `${JSON.stringify({
          thread_id: 'thread_codex_trace',
          type: 'thread.started',
        })}\n`;
        const { sessionId } = await runSendPrompt(prompt, { cwd: appStoragePath }, [rawLine], {
          imageList: [{ id: 'image-1', url: 'data:image/png;base64,UE5HX1RFU1Q=' }],
        });
        const traceRoot = path.join(appStoragePath, '.heerogeneous-tracing');
        const agentTraceRoot = path.join(traceRoot, 'codex');
        const traceDirs = await readdir(agentTraceRoot);

        expect(traceDirs).toHaveLength(1);

        const traceDir = path.join(agentTraceRoot, traceDirs[0]);

        await expect(readFile(path.join(traceRoot, '.last-live-trace'), 'utf8')).resolves.toBe(
          `${traceDir}\n`,
        );
        await expect(readFile(path.join(traceDir, 'stdin.txt'), 'utf8')).resolves.toBe(prompt);
        await expect(readFile(path.join(traceDir, 'stdout.jsonl'), 'utf8')).resolves.toBe(rawLine);
        await expect(readFile(path.join(traceDir, 'stderr.log'), 'utf8')).resolves.toBe('');
        await expect(readFile(path.join(traceDir, 'exit.json'), 'utf8')).resolves.toContain(
          '"code": 0',
        );

        const meta = JSON.parse(await readFile(path.join(traceDir, 'meta.json'), 'utf8'));

        expect(meta).toMatchObject({
          agentType: 'codex',
          command: 'codex',
          cwd: appStoragePath,
          sessionId,
          stdinBytes: Buffer.byteLength(prompt),
          stdoutFile: 'stdout.jsonl',
        });
        expect(meta.args).not.toContain('-');
        expect(meta.attachments).toEqual([{ id: 'image-1', urlKind: 'data' }]);
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('centralizes to heteroAgent/tracing in dev too when the toggle is on', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      // Dev (isPackaged stays false), but the user opted in via the toggle.
      process.env.NODE_ENV = 'development';

      try {
        const prompt = 'trace this opted-in dev run';
        const rawLine = `${JSON.stringify({
          thread_id: 'thread_codex_dev_optin',
          type: 'thread.started',
        })}\n`;
        await runSendPrompt(prompt, { cwd: appStoragePath }, [rawLine], {}, (key: string) =>
          key === 'heteroTracingEnabled' ? true : undefined,
        );

        const agentTraceRoot = path.join(appStoragePath, 'heteroAgent', 'tracing', 'codex');
        const traceDirs = await readdir(agentTraceRoot);
        expect(traceDirs).toHaveLength(1);

        // Toggle wins over the dev cwd default.
        await expect(readdir(path.join(appStoragePath, '.heerogeneous-tracing'))).rejects.toThrow();
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('traces to the centralized heteroAgent/tracing dir in packaged builds when the toggle is on', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      // The gate short-circuits to `false` under NODE_ENV=test, so simulate a
      // real packaged production process.
      process.env.NODE_ENV = 'production';
      (electronAppMock as any).isPackaged = true;

      try {
        const prompt = 'trace this packaged run';
        const rawLine = `${JSON.stringify({
          thread_id: 'thread_codex_packaged',
          type: 'thread.started',
        })}\n`;
        await runSendPrompt(prompt, { cwd: appStoragePath }, [rawLine], {}, (key: string) =>
          key === 'heteroTracingEnabled' ? true : undefined,
        );

        // Centralized under appStoragePath/heteroAgent/tracing — NOT in the cwd.
        const traceRoot = path.join(appStoragePath, 'heteroAgent', 'tracing');
        const agentTraceRoot = path.join(traceRoot, 'codex');
        const traceDirs = await readdir(agentTraceRoot);
        expect(traceDirs).toHaveLength(1);

        const traceDir = path.join(agentTraceRoot, traceDirs[0]);
        await expect(readFile(path.join(traceDir, 'stdout.jsonl'), 'utf8')).resolves.toBe(rawLine);

        // The dev-style cwd location must NOT be written in packaged mode.
        await expect(readdir(path.join(appStoragePath, '.heerogeneous-tracing'))).rejects.toThrow();
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        (electronAppMock as any).isPackaged = false;
      }
    });

    it('does not trace in packaged builds when the toggle is off', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      (electronAppMock as any).isPackaged = true;

      try {
        await runSendPrompt('no trace please', { cwd: appStoragePath }, [], {}, (key: string) =>
          key === 'heteroTracingEnabled' ? false : undefined,
        );

        await expect(
          readdir(path.join(appStoragePath, 'heteroAgent', 'tracing')),
        ).rejects.toThrow();
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        (electronAppMock as any).isPackaged = false;
      }
    });

    it('skips trace creation (and never auto-creates the cwd) when the cwd is missing', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const missingCwd = path.join(appStoragePath, 'does-not-exist');

      try {
        await runSendPrompt('trace this run', { cwd: missingCwd });

        await expect(access(missingCwd)).rejects.toThrow();
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    it('captures the Codex thread id from json output for later resume', async () => {
      const { ctr, sessionId } = await runSendPrompt('hello', {}, [
        `${JSON.stringify({ thread_id: 'thread_codex_123', type: 'thread.started' })}\n`,
      ]);

      await expect(ctr.getSessionInfo({ sessionId })).resolves.toEqual({
        agentSessionId: 'thread_codex_123',
      });
    });

    it('classifies stale Codex resume stderr as a structured resume error', () => {
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);

      const payload = (ctr as any).getSessionErrorPayload(
        'No conversation found for thread thread_stale_123',
        {
          agentSessionId: 'thread_stale_123',
          agentType: 'codex',
          args: [],
          command: 'codex',
          cwd: '/Users/fake/projects/repo',
          resumeSessionId: 'thread_stale_123',
          sessionId: 'session-1',
        },
      );

      expect(payload).toEqual({
        agentType: 'codex',
        code: HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound,
        command: 'codex',
        message: 'The saved Codex thread could not be found, so it can no longer be resumed.',
        resumeSessionId: 'thread_stale_123',
        stderr: 'No conversation found for thread thread_stale_123',
        workingDirectory: '/Users/fake/projects/repo',
      });
    });

    it('classifies CLI authentication failures as auth-required errors', () => {
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);

      const payload = (ctr as any).getSessionErrorPayload(
        'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid authentication credentials"}}',
        {
          agentType: 'claude-code',
          args: [],
          command: 'claude',
          sessionId: 'session-1',
        },
      );

      expect(payload).toEqual({
        agentType: 'claude-code',
        code: HeterogeneousAgentSessionErrorCode.AuthRequired,
        command: 'claude',
        docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
        message:
          'Claude Code could not authenticate. Sign in again or refresh its credentials, then retry.',
        stderr:
          'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid authentication credentials"}}',
      });
    });

    it('classifies missing credentials for Pi as an auth-required error', () => {
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);

      const payload = (ctr as any).getSessionErrorPayload(
        'No API key found for provider anthropic',
        {
          agentType: 'pi',
          args: [],
          command: 'pi',
          sessionId: 'session-1',
        },
      );

      expect(payload).toEqual({
        agentType: 'pi',
        code: HeterogeneousAgentSessionErrorCode.AuthRequired,
        command: 'pi',
        docsUrl: 'https://github.com/earendil-works/pi',
        message: 'Pi could not authenticate. Run `pi`, use `/login`, then retry.',
        stderr: 'No API key found for provider anthropic',
      });
    });
  });

  describe('sendPrompt (droid)', () => {
    it('routes Factory Droid through ACP and persists the native session id', async () => {
      const send = vi.fn();
      mockGetAllWindows.mockReturnValue([
        {
          isDestroyed: () => false,
          webContents: { send },
        },
      ]);
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'droid',
        args: ['--tag', 'lobe'],
        command: 'droid',
        initialModel: 'gpt-5.4',
        resumeSessionId: 'droid_session_old',
      });

      await ctr.sendPrompt({ operationId: 'op-droid', prompt: 'inspect this repo', sessionId });

      expect(spawnCalls).toHaveLength(0);
      expect(droidAcpSessionConstructMock).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ['--tag', 'lobe'],
          clientVersion: '1.0.0-test',
          commandPath: 'droid',
          cwd: FAKE_DESKTOP_PATH,
          initialModel: 'gpt-5.4',
          operationId: 'op-droid',
          prompt: [{ text: 'inspect this repo', type: 'text' }],
          resumeSessionId: 'droid_session_old',
          sessionId,
        }),
      );
      await expect(ctr.getSessionInfo({ sessionId })).resolves.toEqual({
        agentSessionId: 'droid_session_1',
      });
      expect(send).toHaveBeenCalledWith('heteroAgentRuntimeStatus', {
        activeTasks: [],
        lastEventAt: expect.any(Number),
        operationId: 'op-droid',
        sessionId,
        state: 'running',
        transport: 'droid-acp',
      });
      expect(send).toHaveBeenCalledWith('heteroAgentSessionComplete', { sessionId });
    });

    it('classifies a missing Droid ACP session for resume fallback', async () => {
      const send = vi.fn();
      mockGetAllWindows.mockReturnValue([
        {
          isDestroyed: () => false,
          webContents: { send },
        },
      ]);
      const missingSessionError = new AcpRpcResponseError('session/load', {
        code: -32_603,
        data: { details: 'Session missing-droid-session not found' },
        message: 'Failed to load session',
      });
      droidAcpSessionRunMock.mockImplementation(async (options) => {
        await options.onStderr('Droid ACP diagnostic\n');
        throw missingSessionError;
      });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'droid',
        command: 'droid',
        cwd: '/Users/fake/projects/repo',
        resumeSessionId: 'missing-droid-session',
      });

      await expect(
        ctr.sendPrompt({ operationId: 'op-droid-resume', prompt: 'continue', sessionId }),
      ).rejects.toThrow(
        'The saved Factory Droid session could not be found, so a new conversation will start.',
      );

      expect(send).toHaveBeenCalledWith('heteroAgentSessionError', {
        error: {
          agentType: 'droid',
          code: HeterogeneousAgentSessionErrorCode.ResumeThreadNotFound,
          command: 'droid',
          details: {
            code: -32_603,
            data: { details: 'Session missing-droid-session not found' },
          },
          message:
            'The saved Factory Droid session could not be found, so a new conversation will start.',
          resumeSessionId: 'missing-droid-session',
          stderr: missingSessionError.message,
          workingDirectory: '/Users/fake/projects/repo',
        },
        sessionId,
      });
      expect(send).not.toHaveBeenCalledWith('heteroAgentSessionComplete', { sessionId });
    });
  });

  describe('sendPrompt (trae)', () => {
    it('routes TRAE through ACP and persists the native session id', async () => {
      const send = vi.fn();
      mockGetAllWindows.mockReturnValue([
        {
          isDestroyed: () => false,
          webContents: { send },
        },
      ]);
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'trae',
        args: ['--feature=test'],
        command: 'traecli',
        initialModel: 'gpt-5.4',
        resumeSessionId: 'trae_session_old',
      });

      await ctr.sendPrompt({ operationId: 'op-trae', prompt: 'inspect this repo', sessionId });

      expect(spawnCalls).toHaveLength(0);
      expect(traeAcpSessionConstructMock).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ['--feature=test'],
          clientVersion: '1.0.0-test',
          commandPath: 'traecli',
          cwd: FAKE_DESKTOP_PATH,
          initialModel: 'gpt-5.4',
          operationId: 'op-trae',
          prompt: [{ text: 'inspect this repo', type: 'text' }],
          resumeSessionId: 'trae_session_old',
          sessionId,
        }),
      );
      await expect(ctr.getSessionInfo({ sessionId })).resolves.toEqual({
        agentSessionId: 'trae_session_1',
      });
      expect(send).toHaveBeenCalledWith('heteroAgentRuntimeStatus', {
        activeTasks: [],
        lastEventAt: expect.any(Number),
        operationId: 'op-trae',
        sessionId,
        state: 'running',
        transport: 'trae-acp',
      });
      expect(send).toHaveBeenCalledWith('heteroAgentSessionComplete', { sessionId });
    });

    it('launches a provider-bound TRAE session with a managed secret-free profile', async () => {
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'trae',
        args: ['--model', 'stale-model', '--profile', 'personal', '--permission-mode', 'auto'],
        command: 'traecli',
        env: {
          LOBEHUB_TRAE_API_KEY: 'stale-host-key',
          OPENAI_API_KEY: 'stale-openai-key',
          TRAE_HOME: '/user/trae',
        },
        initialModel: 'stale-native-model',
        providerBinding: {
          apiConfig: { model: 'gpt-test', providerId: 'openai' },
          kind: 'provider',
        },
      });

      await ctr.sendPrompt({ operationId: 'op-trae-provider', prompt: 'hello', sessionId });

      const options = traeAcpSessionConstructMock.mock.calls.at(-1)?.[0];
      expect(options.args).toEqual(['--permission-mode', 'auto', '--profile', 'lobehub']);
      expect(options.initialModel).toBeUndefined();
      expect(options.env).toEqual(
        expect.objectContaining({
          LOBEHUB_TRAE_API_KEY: 'provider-secret',
          TRAE_HOME: expect.stringContaining('/heteroAgent/bindings/trae/'),
        }),
      );
      expect(options.env).not.toHaveProperty('OPENAI_API_KEY');

      const bindingsDir = path.join(appStoragePath, 'heteroAgent', 'bindings', 'trae');
      const [bindingDir] = await readdir(bindingsDir);
      const profile = await readFile(
        path.join(bindingsDir, bindingDir, 'lobehub.traecli.toml'),
        'utf8',
      );
      expect(profile).toContain('model = "gpt-test"');
      expect(profile).toContain('model_provider = "lobehub"');
      expect(profile).toContain('base_url = "https://api.openai.com/v1"');
      expect(profile).toContain('env_key = "LOBEHUB_TRAE_API_KEY"');
      expect(profile).toContain('wire_api = "responses"');
      expect(profile).not.toContain('provider-secret');
      expect(JSON.stringify(loggerInfoMock.mock.calls)).not.toContain('provider-secret');
      expect(await readdir(path.join(appStoragePath, 'heteroAgent', 'runs'))).toEqual([]);
    });

    it('injects a server-default operation token into the TRAE Responses profile', async () => {
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'trae',
        command: 'traecli',
        providerBinding: {
          apiConfig: { model: 'gpt-5.4', source: 'server-default' },
          kind: 'server-default',
        },
      });

      await ctr.sendPrompt({
        operationId: 'op-trae-server-default',
        prompt: 'hello',
        sessionId,
        topicId: 'topic-1',
      });

      expect(beginServerDefaultOperationMock).toHaveBeenCalledWith(expect.any(Object), {
        agentId: undefined,
        agentType: 'trae',
        model: 'gpt-5.4',
        operationId: 'op-trae-server-default',
        topicId: 'topic-1',
      });
      const options = traeAcpSessionConstructMock.mock.calls.at(-1)?.[0];
      expect(options.args).toEqual(['--profile', 'lobehub']);
      expect(options.env).toEqual(
        expect.objectContaining({
          LOBEHUB_TRAE_API_KEY: 'operation-token',
          TRAE_HOME: expect.stringContaining('/heteroAgent/bindings/trae/'),
        }),
      );

      const bindingsDir = path.join(appStoragePath, 'heteroAgent', 'bindings', 'trae');
      const [bindingDir] = await readdir(bindingsDir);
      const profile = await readFile(
        path.join(bindingsDir, bindingDir, 'lobehub.traecli.toml'),
        'utf8',
      );
      expect(profile).toContain('model = "lobehub/gpt-5.4"');
      expect(profile).toContain('base_url = "https://app.example.com/api/v1/openai/v1"');
      expect(profile).not.toContain('operation-token');
      expect(settleServerDefaultOperationMock).toHaveBeenCalledWith(expect.any(Object), {
        cancelled: false,
        operationId: 'op-trae-server-default',
        result: 'done',
      });
    });

    it('requires TRAE CLI 0.201.2 for provider binding but not subscription mode', async () => {
      const detect = vi.fn().mockResolvedValue({ available: true, version: '0.201.1' });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        binaryManager: { detect },
        storeManager: { get: vi.fn() },
      } as any);
      const providerSession = await ctr.startSession({
        agentType: 'trae',
        command: 'traecli',
        providerBinding: {
          apiConfig: { model: 'gpt-test', providerId: 'openai' },
          kind: 'provider',
        },
      });

      await expect(
        ctr.sendPrompt({
          operationId: 'op-trae-old-provider',
          prompt: 'provider prompt',
          sessionId: providerSession.sessionId,
        }),
      ).rejects.toThrow(
        'TRAE CLI 0.201.2 or newer is required to use a LobeHub provider. Installed version: 0.201.1.',
      );
      expect(traeAcpSessionConstructMock).not.toHaveBeenCalled();

      const subscriptionSession = await ctr.startSession({
        agentType: 'trae',
        command: 'traecli',
      });
      await ctr.sendPrompt({
        operationId: 'op-trae-old-subscription',
        prompt: 'subscription prompt',
        sessionId: subscriptionSession.sessionId,
      });

      expect(traeAcpSessionConstructMock).toHaveBeenCalledOnce();
    });

    it('classifies authentication diagnostics emitted only on ACP stderr', async () => {
      const send = vi.fn();
      mockGetAllWindows.mockReturnValue([
        {
          isDestroyed: () => false,
          webContents: { send },
        },
      ]);
      traeAcpSessionRunMock.mockImplementation(async (options) => {
        await options.onStderr('Please sign in through TRAE Enterprise\n');
        throw new Error('TRAE ACP exited unexpectedly (code 1, signal null)');
      });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'trae',
        command: 'traecli',
      });

      await expect(
        ctr.sendPrompt({ operationId: 'op-trae-auth', prompt: 'work', sessionId }),
      ).rejects.toThrow('TRAE CLI could not authenticate');
      expect(send).toHaveBeenCalledWith('heteroAgentSessionError', {
        error: expect.objectContaining({
          agentType: 'trae',
          code: HeterogeneousAgentSessionErrorCode.AuthRequired,
          command: 'traecli',
          stderr: expect.stringContaining('Please sign in through TRAE Enterprise'),
        }),
        sessionId,
      });
    });
  });

  describe('pre-launch cancellation for local transports', () => {
    beforeEach(() => {
      spawnCalls.length = 0;
      execFileMock.mockReset();
    });

    it.each([
      {
        agentType: 'codex',
        command: 'codex',
        constructMock: codexAppServerConstructMock,
        label: 'Codex app-server',
        runMock: codexAppServerRunMock,
        useCodexAppServer: true,
      },
      {
        agentType: 'grok-build',
        command: 'grok',
        constructMock: grokAcpSessionConstructMock,
        label: 'Grok ACP',
        runMock: grokAcpSessionRunMock,
        useCodexAppServer: false,
      },
      {
        agentType: 'cursor',
        command: 'agent',
        constructMock: cursorAcpSessionConstructMock,
        label: 'Cursor ACP',
        runMock: cursorAcpSessionRunMock,
        useCodexAppServer: false,
      },
      {
        agentType: 'trae',
        command: 'traecli',
        constructMock: traeAcpSessionConstructMock,
        label: 'TRAE ACP',
        runMock: traeAcpSessionRunMock,
        useCodexAppServer: false,
      },
    ] as const)(
      'does not start $label when cancelled during transport preparation',
      async ({ agentType, command, constructMock, runMock, useCodexAppServer }) => {
        const send = vi.fn();
        mockGetAllWindows.mockReturnValue([
          {
            isDestroyed: () => false,
            webContents: { send },
          },
        ]);
        const ctr = new HeterogeneousAgentCtr({
          appStoragePath,
          storeManager: { get: vi.fn() },
        } as any);
        const { sessionId } = await ctr.startSession({
          agentType,
          command,
          useCodexAppServer,
        });
        let completePreparation!: () => void;
        const createTraceSession = vi
          .spyOn(ctr as any, 'createCliTraceSession')
          .mockImplementationOnce(
            () =>
              new Promise<void>((resolve) => {
                completePreparation = resolve;
              }),
          );

        const sendPrompt = ctr.sendPrompt({
          operationId: `op-cancel-${agentType}`,
          prompt: 'work',
          sessionId,
        });
        await vi.waitFor(() => expect(createTraceSession).toHaveBeenCalledOnce());

        await ctr.cancelSession({ sessionId });
        completePreparation();
        await sendPrompt;

        expect(constructMock).not.toHaveBeenCalled();
        expect(runMock).not.toHaveBeenCalled();
        expect(spawnCalls).toHaveLength(0);
        expect(send).toHaveBeenCalledWith('heteroAgentSessionComplete', { sessionId });
      },
    );
  });

  describe('spawnLhHeteroExec', () => {
    const params = {
      agentType: 'opencode',
      assistantMessageId: 'asst-gateway',
      jwt: 'device-jwt',
      operationId: 'op-gateway',
      prompt: 'inspect the repository',
      serverUrl: 'https://server.example.com',
      topicId: 'topic-gateway',
    };

    const createGatewayCliProc = () => {
      const proc = new EventEmitter() as any;
      const stdin = new EventEmitter() as any;
      stdin.end = vi.fn();
      stdin.write = vi.fn(() => true);
      proc.kill = vi.fn(() => true);
      proc.pid = 4321;
      proc.stdin = stdin;
      return proc;
    };

    beforeEach(() => {
      vi.mocked(existsSync).mockReturnValue(true);
      spawnCalls.length = 0;
      nextFakeProc = null;
    });

    it('uses the self-contained embedded CLI instead of a global lh from PATH', async () => {
      const proc = createGatewayCliProc();
      nextFakeProc = proc;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);

      const ack = ctr.spawnLhHeteroExec(params);

      expect(spawnCalls).toHaveLength(1);
      const [spawnCall] = spawnCalls;
      expect(spawnCall.command).toBe(process.execPath);
      expect(spawnCall.args.slice(0, 7)).toEqual([
        '/fake/cli/dist/index.js',
        'hetero',
        'exec',
        '--type',
        'opencode',
        '--operation-id',
        'op-gateway',
      ]);
      expect(spawnCall.options.cwd).toBe(process.cwd());
      expect(spawnCall.options.env).toEqual(
        expect.objectContaining({
          ELECTRON_RUN_AS_NODE: '1',
          LOBEHUB_ASSISTANT_MESSAGE_ID: 'asst-gateway',
          LOBEHUB_JWT: 'device-jwt',
          LOBEHUB_SERVER: 'https://server.example.com',
        }),
      );
      expect(spawnCall.options.env).not.toHaveProperty('LOBEHUB_WORKSPACE_ID');
      expect(proc.stdin.write).not.toHaveBeenCalled();

      proc.emit('spawn');

      await expect(ack).resolves.toEqual({ status: 'accepted' });
      expect(proc.stdin.write).toHaveBeenCalledOnce();
      expect(proc.stdin.end).toHaveBeenCalledOnce();
    });

    it('forwards the topic workspace as LOBEHUB_WORKSPACE_ID for ingest', async () => {
      const proc = createGatewayCliProc();
      nextFakeProc = proc;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);

      const ack = ctr.spawnLhHeteroExec({ ...params, workspaceId: 'ws-lobehub' });
      proc.emit('spawn');
      await expect(ack).resolves.toEqual({ status: 'accepted' });

      expect(spawnCalls[0].options.env).toEqual(
        expect.objectContaining({ LOBEHUB_WORKSPACE_ID: 'ws-lobehub' }),
      );
    });

    it('encodes primary and resume fallback contexts for the embedded CLI', async () => {
      const proc = createGatewayCliProc();
      nextFakeProc = proc;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);

      const ack = ctr.spawnLhHeteroExec({
        ...params,
        resumeFallbackSystemContext: 'workspace rules\n\nprevious conversation',
        resumeSessionId: 'session-1',
        systemContext: 'workspace rules',
      });
      proc.emit('spawn');

      await expect(ack).resolves.toEqual({ status: 'accepted' });
      expect(proc.stdin.write).toHaveBeenCalledWith(
        JSON.stringify({
          content: [
            { text: 'workspace rules', type: 'text' },
            { text: 'inspect the repository', type: 'text' },
          ],
          resumeFallback: [
            { text: 'workspace rules\n\nprevious conversation', type: 'text' },
            { text: 'inspect the repository', type: 'text' },
          ],
        }),
      );
    });

    it('rejects the gateway request when the embedded CLI cannot spawn', async () => {
      const proc = createGatewayCliProc();
      nextFakeProc = proc;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);

      const ack = ctr.spawnLhHeteroExec(params);
      proc.emit('error', new Error('spawn EACCES'));

      await expect(ack).resolves.toEqual({ reason: 'spawn EACCES', status: 'rejected' });
      expect(proc.stdin.write).not.toHaveBeenCalled();
    });

    it('starts the wrapper from home so its inner preflight can report a missing cwd', async () => {
      const missingCwd = '/missing/project';
      const proc = createGatewayCliProc();
      nextFakeProc = proc;
      mockMissingDir(missingCwd);
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);

      const ack = ctr.spawnLhHeteroExec({ ...params, cwd: missingCwd });

      expect(spawnCalls).toHaveLength(1);
      const [spawnCall] = spawnCalls;
      const cwdArgIndex = spawnCall.args.indexOf('--cwd');
      expect(spawnCall.options.cwd).toBe(os.homedir());
      expect(spawnCall.args[cwdArgIndex + 1]).toBe(missingCwd);
      expect(spawnCall.args).not.toContain('--raw-dump');
      proc.emit('spawn');

      await expect(ack).resolves.toEqual({ status: 'accepted' });
      expect(proc.stdin.write).toHaveBeenCalledOnce();
    });

    it('rejects before spawn when the embedded CLI is missing', async () => {
      vi.mocked(existsSync).mockImplementation(
        (candidate) => candidate !== '/fake/cli/dist/index.js',
      );
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);

      await expect(ctr.spawnLhHeteroExec(params)).resolves.toEqual({
        reason: 'Embedded CLI not found at /fake/cli/dist/index.js',
        status: 'rejected',
      });
      expect(spawnCalls).toHaveLength(0);
    });

    it('rejects a synchronous stdin write failure without throwing from the event handler', async () => {
      const proc = createGatewayCliProc();
      proc.stdin.write.mockImplementationOnce(() => {
        throw new Error('write EPIPE');
      });
      nextFakeProc = proc;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);

      const ack = ctr.spawnLhHeteroExec(params);
      expect(() => proc.emit('spawn')).not.toThrow();

      await expect(ack).resolves.toEqual({ reason: 'write EPIPE', status: 'rejected' });
    });

    it('handles a late stdin EPIPE after acceptance without an uncaught stream error', async () => {
      const proc = createGatewayCliProc();
      nextFakeProc = proc;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);

      const ack = ctr.spawnLhHeteroExec(params);
      proc.emit('spawn');
      await expect(ack).resolves.toEqual({ status: 'accepted' });

      expect(() => proc.stdin.emit('error', new Error('write EPIPE'))).not.toThrow();
    });

    /**
     * @example A replacement waits until operation A's wrapper exits before operation B starts.
     */
    it('waits for the gateway CLI wrapper to exit when cancelling its operation', async () => {
      // ROOT CAUSE:
      //
      // Device-dispatched Codex wrappers were not registered by operation id, so
      // server cancellation returned while the native thread still had an active
      // writer. A replacement resume then failed with `already has an active writer`.
      //
      // Before: spawnLhHeteroExec acknowledged the child and discarded its handle.
      // After: cancelLhHeteroExec signals that handle and resolves only after exit.
      const proc = createGatewayCliProc();
      nextFakeProc = proc;
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);

      const ack = ctr.spawnLhHeteroExec(params);
      proc.emit('spawn');
      await ack;

      let cancellationSettled = false;
      const cancellation = ctr
        .cancelLhHeteroExec({ operationId: params.operationId })
        .then((result) => {
          cancellationSettled = true;
          return result;
        });
      await Promise.resolve();

      expect(proc.kill).toHaveBeenCalledWith('SIGINT');
      expect(cancellationSettled).toBe(false);

      proc.emit('exit', 130, 'SIGINT');

      await expect(cancellation).resolves.toEqual({
        exited: true,
        pid: 4321,
        signal: 'SIGINT',
      });
    });
  });

  /**
   * Node may emit `proc.on('exit')` BEFORE stdout fully drains (documented in
   * child_process docs as "stdio streams might still be open"). The phase 0
   * refactor moved adapter ownership to main, so renderer no longer flushes
   * its own adapter on session-complete — meaning trailing events from
   * `pipeline.flush()` (e.g. Codex's synthesized `tool_end` for unfinished
   * tool calls) would race against — and lose to — the
   * `heteroAgentSessionComplete` broadcast without an explicit gate.
   *
   * The fix in `proc.on('exit')` is to await stdout `'end'/'close'` (so the
   * `stdout.on('end')` handler can schedule `pipeline.flush()` onto the
   * broadcast queue), then drain the queue, then broadcast complete.
   */
  describe('exit-before-end ordering (phase 0 race)', () => {
    let broadcasts: Array<{ channel: string; data: any }>;

    beforeEach(() => {
      spawnCalls.length = 0;
      execFileMock.mockReset();
      broadcasts = [];
      mockGetAllWindows.mockImplementation(() => [
        {
          isDestroyed: () => false,
          webContents: {
            send: (channel: string, data: any) => broadcasts.push({ channel, data }),
          },
        },
      ]);
    });

    afterEach(() => {
      mockGetAllWindows.mockReset();
      mockGetAllWindows.mockReturnValue([]);
    });

    it('delivers pipeline.flush() events BEFORE heteroAgentSessionComplete even when proc exit precedes stdout end', async () => {
      // Codex `item.started` for a tool — adapter buffers it as a pending
      // tool call. On flush, adapter synthesizes a trailing `tool_end`. This
      // is exactly the kind of event the race would lose against complete.
      const itemStarted = `${JSON.stringify({
        item: {
          aggregated_output: '',
          command: 'echo hi',
          id: 'cmd-1',
          status: 'in_progress',
          type: 'command_execution',
        },
        type: 'item.started',
      })}\n`;
      const threadStarted = `${JSON.stringify({ thread_id: 't1', type: 'thread.started' })}\n`;

      const proc = new EventEmitter() as any;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      proc.stdout = stdout;
      proc.stderr = stderr;
      proc.stdin = {
        end: vi.fn(),
        write: vi.fn((_chunk: any, cb?: () => void) => {
          cb?.();
          return true;
        }),
      };
      proc.kill = vi.fn();
      proc.killed = false;
      proc.__start = () => {
        setImmediate(() => {
          stdout.write(threadStarted);
          stdout.write(itemStarted);
          stderr.end();
          // ⚠️ Reproduce the documented Node race: emit exit BEFORE stdout
          // ends. Without the streamFinished gate in the controller, the
          // broadcast queue settles immediately (no flush queued yet) and
          // complete fires before the trailing tool_end ever broadcasts.
          proc.emit('exit', 0);
          setImmediate(() => stdout.end());
        });
      };
      nextFakeProc = proc;

      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({ agentType: 'codex', command: 'codex' });
      await ctr.sendPrompt({ operationId: 'op-test', prompt: 'hello', sessionId });

      const events = broadcasts.filter((b) => b.channel === 'heteroAgentEvent');
      const completeIdx = broadcasts.findIndex((b) => b.channel === 'heteroAgentSessionComplete');
      const lastEventIdx = broadcasts.findLastIndex((b) => b.channel === 'heteroAgentEvent');

      expect(completeIdx).toBeGreaterThan(-1);
      expect(events.length).toBeGreaterThan(0);
      // Every stream event must land before complete — no trailing events
      // sneak in after the renderer has been told the session is done.
      expect(lastEventIdx).toBeLessThan(completeIdx);

      // Specifically: the synthesized tool_end for the pending command
      // execution (emitted only by adapter.flush()) is in the broadcast.
      const toolEnds = events.filter((b) => (b.data as any)?.event?.type === 'tool_end');
      expect(toolEnds.length).toBeGreaterThan(0);
    });

    it('broadcasts an Amp protocol error before completion when exit zero has no result', async () => {
      const initLine = `${JSON.stringify({
        session_id: 'T-amp-missing-result',
        subtype: 'init',
        type: 'system',
      })}\n`;
      const assistantLine = `${JSON.stringify({
        message: {
          content: [{ text: 'Incomplete answer', type: 'text' }],
          role: 'assistant',
        },
        type: 'assistant',
      })}\n`;
      nextFakeProc = createFakeProc({ stdoutLines: [initLine, assistantLine] }).proc;

      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({ agentType: 'amp', command: 'amp' });
      await ctr.sendPrompt({ operationId: 'op-test', prompt: 'hello', sessionId });

      const errorIdx = broadcasts.findIndex(
        (broadcast) =>
          broadcast.channel === 'heteroAgentEvent' &&
          (broadcast.data as any)?.event?.type === 'error' &&
          (broadcast.data as any)?.event?.data?.code === 'protocol_error',
      );
      const completeIdx = broadcasts.findIndex(
        (broadcast) => broadcast.channel === 'heteroAgentSessionComplete',
      );
      const runtimeEnd = broadcasts.find(
        (broadcast) =>
          broadcast.channel === 'heteroAgentEvent' &&
          (broadcast.data as any)?.event?.type === 'agent_runtime_end',
      );

      expect(errorIdx).toBeGreaterThan(-1);
      expect(errorIdx).toBeLessThan(completeIdx);
      expect(runtimeEnd).toBeUndefined();
    });

    it('delivers late final Codex stdout chunks BEFORE heteroAgentSessionComplete', async () => {
      const threadStarted = `${JSON.stringify({ thread_id: 't1', type: 'thread.started' })}\n`;
      const turnStarted = `${JSON.stringify({ type: 'turn.started' })}\n`;
      const finalMessage = `${JSON.stringify({
        item: {
          id: 'item_103',
          text: 'Final report after late stdout.',
          type: 'agent_message',
        },
        type: 'item.completed',
      })}\n`;
      const turnCompleted = `${JSON.stringify({
        type: 'turn.completed',
        usage: { input_tokens: 10, output_tokens: 5 },
      })}\n`;

      const proc = new EventEmitter() as any;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      proc.stdout = stdout;
      proc.stderr = stderr;
      proc.stdin = {
        end: vi.fn(),
        write: vi.fn((_chunk: any, cb?: () => void) => {
          cb?.();
          return true;
        }),
      };
      proc.kill = vi.fn();
      proc.killed = false;
      proc.__start = () => {
        setImmediate(() => {
          stdout.write(threadStarted);
          stdout.write(turnStarted);
          stderr.end();
          proc.emit('exit', 0);
          setImmediate(() => {
            stdout.write(finalMessage);
            stdout.write(turnCompleted);
            stdout.end();
          });
        });
      };
      nextFakeProc = proc;

      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({ agentType: 'codex', command: 'codex' });
      const sendStartedAt = Date.now();
      await ctr.sendPrompt({ operationId: 'op-test', prompt: 'hello', sessionId });
      const sendDurationMs = Date.now() - sendStartedAt;

      const completeIdx = broadcasts.findIndex((b) => b.channel === 'heteroAgentSessionComplete');
      const finalChunkIdx = broadcasts.findIndex(
        (b) =>
          b.channel === 'heteroAgentEvent' &&
          (b.data as any)?.event?.type === 'stream_chunk' &&
          (b.data as any)?.event?.data?.content === 'Final report after late stdout.',
      );
      const runtimeEndIdx = broadcasts.findIndex(
        (b) =>
          b.channel === 'heteroAgentEvent' && (b.data as any)?.event?.type === 'agent_runtime_end',
      );

      expect(completeIdx).toBeGreaterThan(-1);
      expect(finalChunkIdx).toBeGreaterThan(-1);
      expect(runtimeEndIdx).toBeGreaterThan(-1);
      expect(finalChunkIdx).toBeLessThan(completeIdx);
      expect(runtimeEndIdx).toBeLessThan(completeIdx);
      expect(sendDurationMs).toBeGreaterThanOrEqual(900);
    });

    it('serializes AskUserQuestion bridge events behind already-queued stdout tool events', async () => {
      const initLine = `${JSON.stringify({
        model: 'claude-sonnet-4-6',
        session_id: 'cc-session-1',
        subtype: 'init',
        type: 'system',
      })}\n`;
      const askToolUseLine = `${JSON.stringify({
        message: {
          content: [
            {
              id: 'toolu_ask',
              input: {
                questions: [
                  {
                    header: 'Scope',
                    options: [
                      { description: 'Keep it narrow', label: 'Small' },
                      { description: 'Do all of it', label: 'All' },
                    ],
                    question: 'How much should I do?',
                  },
                ],
              },
              name: 'mcp__lobe_cc__ask_user_question',
              type: 'tool_use',
            },
          ],
          id: 'msg_ask',
          model: 'claude-sonnet-4-6',
          role: 'assistant',
        },
        type: 'assistant',
      })}\n`;

      const proc = new EventEmitter() as any;
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      proc.stdout = stdout;
      proc.stderr = stderr;
      proc.stdin = {
        end: vi.fn(),
        write: vi.fn((_chunk: any, cb?: () => void) => {
          cb?.();
          return true;
        }),
      };
      proc.kill = vi.fn();
      proc.killed = false;

      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);

      proc.__start = () => {
        setImmediate(() => {
          stdout.write(initLine);
          stdout.write(askToolUseLine);

          const bridge = (ctr as any).opIdToIntervention.get('op-test')?.bridge;
          void bridge?.pending({
            arguments: {
              questions: [
                {
                  header: 'Scope',
                  options: [
                    { description: 'Keep it narrow', label: 'Small' },
                    { description: 'Do all of it', label: 'All' },
                  ],
                  question: 'How much should I do?',
                },
              ],
            },
            toolCallId: 'toolu_ask',
          });

          stderr.end();
          stdout.end();
          proc.emit('exit', 0);
        });
      };
      nextFakeProc = proc;

      const { sessionId } = await ctr.startSession({ agentType: 'claude-code', command: 'claude' });
      await ctr.sendPrompt({ operationId: 'op-test', prompt: 'hello', sessionId });

      const toolEventIdx = broadcasts.findIndex(
        (b) =>
          b.channel === 'heteroAgentEvent' &&
          (b.data as any)?.event?.type === 'stream_chunk' &&
          (b.data as any)?.event?.data?.toolsCalling?.some((tool: any) => tool.id === 'toolu_ask'),
      );
      const interventionIdx = broadcasts.findIndex(
        (b) =>
          b.channel === 'heteroAgentEvent' &&
          (b.data as any)?.event?.type === 'agent_intervention_request' &&
          (b.data as any)?.event?.data?.toolCallId === 'toolu_ask',
      );

      expect(toolEventIdx).toBeGreaterThan(-1);
      expect(interventionIdx).toBeGreaterThan(-1);
      expect(toolEventIdx).toBeLessThan(interventionIdx);
    });
  });

  describe('app-quit cleanup of AskUserQuestion temp configs ()', () => {
    // The async exit-handler cleanup races Electron's main-process teardown
    // and used to leak `lobe-cc-mcp-<opId>.json` files in `os.tmpdir()` on
    // every quit. The controller now unlinks pending intervention temp
    // configs *synchronously* from `before-quit` AND from process signal
    // handlers (SIGTERM / SIGINT — `before-quit` doesn't fire on external
    // kills). These tests exercise both paths against real files.

    /**
     * Drop a temp `lobe-cc-mcp-<id>.json` and stash it on the controller's
     * `opIdToIntervention` map under the same key, so the quit hook treats
     * it like a real pending intervention and tries to unlink it.
     */
    const seedPendingIntervention = async (ctr: HeterogeneousAgentCtr, opId: string) => {
      const tmpConfigPath = path.join(os.tmpdir(), `lobe-cc-mcp-test-${opId}.json`);
      await writeFile(tmpConfigPath, '{"mcpServers":{}}');
      const slot = {
        bridge: {} as any,
        pumpDone: Promise.resolve(),
        tmpConfigPath,
      };
      (ctr as any).opIdToIntervention.set(opId, slot);
      return tmpConfigPath;
    };

    const captureRegisteredHandler = (
      registerSpy: ReturnType<typeof vi.fn> | ReturnType<typeof vi.spyOn>,
      eventName: string,
    ): (() => void) => {
      const calls = (registerSpy as any).mock.calls as Array<[string, () => void]>;
      const match = calls.findLast(([evt]) => evt === eventName);
      if (!match) throw new Error(`no handler registered for "${eventName}"`);
      return match[1];
    };

    it('before-quit closes a running TRAE ACP session', async () => {
      const electron = (await import('electron')) as any;
      electron.app.on.mockClear();
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({ agentType: 'trae', command: 'traecli' });
      const session = (ctr as any).sessions.get(sessionId);
      session.traeAcpSession = { close: traeAcpSessionCloseMock };

      ctr.afterAppReady();
      const beforeQuit = captureRegisteredHandler(electron.app.on, 'before-quit');
      beforeQuit();

      expect(traeAcpSessionCloseMock).toHaveBeenCalledOnce();
      expect(session.cancelledByUs).toBe(true);
      expect((ctr as any).sessions.has(sessionId)).toBe(false);
    });

    it('before-quit synchronously unlinks every pending intervention temp config', async () => {
      const electron = (await import('electron')) as any;
      electron.app.on.mockClear();

      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);

      const fileA = await seedPendingIntervention(ctr, 'opA');
      const fileB = await seedPendingIntervention(ctr, 'opB');

      ctr.afterAppReady();
      const beforeQuit = captureRegisteredHandler(electron.app.on, 'before-quit');
      beforeQuit();

      await expect(access(fileA)).rejects.toThrow();
      await expect(access(fileB)).rejects.toThrow();
    });

    it('SIGTERM handler unlinks pending intervention temp configs (external-kill path)', async () => {
      // External kills (test harness, OS shutdown) skip Electron's lifecycle
      // events entirely — `before-quit` never fires, so the controller has to
      // hook the raw process signal too. Stub `process.on` so the handler is
      // *recorded* but never actually attached to the test runner's process
      // (otherwise the test leaks a SIGTERM listener that survives the test).
      // Same for `process.exit` — the controller's fail-safe shouldn't get a
      // chance to actually exit the worker if its `setTimeout(...).unref()`
      // ever fires before mockRestore.
      const electron = (await import('electron')) as any;
      electron.app.on.mockClear();
      const processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const file = await seedPendingIntervention(ctr, 'opSigterm');

      ctr.afterAppReady();
      const sigterm = captureRegisteredHandler(processOnSpy, 'SIGTERM');
      sigterm();

      await expect(access(file)).rejects.toThrow();

      processOnSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('SIGINT handler unlinks pending intervention temp configs (Ctrl-C path)', async () => {
      const electron = (await import('electron')) as any;
      electron.app.on.mockClear();
      const processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const file = await seedPendingIntervention(ctr, 'opSigint');

      ctr.afterAppReady();
      const sigint = captureRegisteredHandler(processOnSpy, 'SIGINT');
      sigint();

      await expect(access(file)).rejects.toThrow();

      processOnSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('cleanup is idempotent — already-deleted files do not throw', async () => {
      const electron = (await import('electron')) as any;
      electron.app.on.mockClear();

      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const file = await seedPendingIntervention(ctr, 'opIdempotent');

      // Pre-delete the file out from under the controller — simulates a
      // partial cleanup race where the async exit handler beat us to it.
      await unlink(file);

      ctr.afterAppReady();
      const beforeQuit = captureRegisteredHandler(electron.app.on, 'before-quit');
      expect(() => beforeQuit()).not.toThrow();
    });
  });
});
