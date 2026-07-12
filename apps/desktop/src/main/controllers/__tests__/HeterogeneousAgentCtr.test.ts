import { EventEmitter } from 'node:events';
import { access, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
// `electron` is mocked below; this binding is the mock object so tests can
// flip `isPackaged` to exercise the packaged-build tracing gate.
import { app as electronAppMock } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HeterogeneousAgentCtr from '../HeterogeneousAgentCtr';

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => 'linux') };
});

const FAKE_DESKTOP_PATH = '/Users/fake/Desktop';

const { mockGetAllWindows } = vi.hoisted(() => ({
  mockGetAllWindows: vi.fn<() => any[]>(() => []),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => mockGetAllWindows() },
  app: {
    getAppPath: vi.fn(() => '/fake/appPath'),
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
    info: vi.fn(),
    verbose: vi.fn(),
    warn: vi.fn(),
  }),
}));

const { claudeSdkSessionCloseMock, claudeSdkSessionConstructMock } = vi.hoisted(() => ({
  claudeSdkSessionCloseMock: vi.fn(),
  claudeSdkSessionConstructMock: vi.fn(),
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

  return {
    ...actual,
    ClaudeAgentSdkSession: MockClaudeAgentSdkSession,
  };
});

const { fetchCodexQuotaMock } = vi.hoisted(() => ({
  fetchCodexQuotaMock: vi.fn(),
}));

vi.mock('@/modules/heterogeneousAgent/codexQuota', () => ({
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

  beforeEach(async () => {
    originalClaudeSdkLabEnv = process.env.LOBE_CLAUDE_CODE_SDK;
    appStoragePath = await mkdtemp(path.join(os.tmpdir(), 'lobehub-hetero-'));
    fetchCodexQuotaMock.mockReset();
    claudeSdkSessionCloseMock.mockReset();
    claudeSdkSessionConstructMock.mockReset();
    mockGetAllWindows.mockReset();
    delete process.env.LOBE_CLAUDE_CODE_SDK;
  });

  afterEach(async () => {
    if (originalClaudeSdkLabEnv === undefined) delete process.env.LOBE_CLAUDE_CODE_SDK;
    else process.env.LOBE_CLAUDE_CODE_SDK = originalClaudeSdkLabEnv;
    await rm(appStoragePath, { force: true, recursive: true });
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

    it('captures the Claude Code session id from stream-json init events', async () => {
      const { ctr, sessionId } = await runSendPrompt('hello', {}, [
        `${JSON.stringify({ session_id: 'sess_cc_123', subtype: 'init', type: 'system' })}\n`,
      ]);

      await expect(ctr.getSessionInfo({ sessionId })).resolves.toEqual({
        agentSessionId: 'sess_cc_123',
      });
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

      expect(detect).toHaveBeenCalledWith('codex', true);
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

      expect(detect).toHaveBeenCalledWith('claude', true);
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
