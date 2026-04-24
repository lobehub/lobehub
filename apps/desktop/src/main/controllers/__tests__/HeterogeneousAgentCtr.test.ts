import { EventEmitter } from 'node:events';
import { access, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HeterogeneousAgentCtr from '../HeterogeneousAgentCtr';

const FAKE_DESKTOP_PATH = '/Users/fake/Desktop';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: {
    getPath: vi.fn((name: string) => (name === 'desktop' ? FAKE_DESKTOP_PATH : `/fake/${name}`)),
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
  stdoutLines = [],
}: {
  exitCode?: number;
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

  beforeEach(async () => {
    appStoragePath = await mkdtemp(path.join(tmpdir(), 'lobehub-hetero-'));
  });

  afterEach(async () => {
    await rm(appStoragePath, { force: true, recursive: true });
  });

  describe('resolveImage', () => {
    it('stores traversal-looking ids inside the cache root via a stable hash key', async () => {
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const cacheDir = path.join(appStoragePath, 'heteroAgent/files');
      const escapedTargetName = `${path.basename(appStoragePath)}-outside-storage`;
      const escapePath = path.join(cacheDir, `../../../${escapedTargetName}`);

      try {
        await unlink(escapePath);
      } catch {
        // best-effort cleanup
      }

      await (ctr as any).resolveImage({
        id: `../../../${escapedTargetName}`,
        url: 'data:text/plain;base64,T1VUU0lERQ==',
      });

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
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const cacheDir = path.join(appStoragePath, 'heteroAgent/files');
      const traversalId = '../../preexisting-secret';
      const outOfRootDataPath = path.join(cacheDir, traversalId);
      const outOfRootMetaPath = path.join(cacheDir, `${traversalId}.meta`);

      await writeFile(outOfRootDataPath, 'SECRET');
      await writeFile(
        outOfRootMetaPath,
        JSON.stringify({ id: traversalId, mimeType: 'text/plain' }),
      );

      const result = await (ctr as any).resolveImage({
        id: traversalId,
        url: 'data:text/plain;base64,SUdOT1JFRA==',
      });

      expect(Buffer.from(result.buffer).toString('utf8')).toBe('IGNORED');
      expect(result.mimeType).toBe('text/plain');
      await expect(readFile(outOfRootDataPath, 'utf8')).resolves.toBe('SECRET');
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
      await ctr.sendPrompt({ prompt, sessionId });

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
      sendPromptOverrides: Partial<{ imageList: Array<{ id: string; url: string }> }> = {},
    ) => {
      const { proc, writes } = createFakeProc({ stdoutLines });
      nextFakeProc = proc;

      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
        ...sessionOverrides,
      });
      await ctr.sendPrompt({ prompt, sessionId, ...sendPromptOverrides });

      const { args: cliArgs, command, options } = spawnCalls[0];
      return { cliArgs, command, ctr, options, sessionId, writes };
    };

    it('fails fast when Codex CLI is unavailable instead of attempting spawn', async () => {
      const detect = vi.fn().mockResolvedValue({ available: false });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
        toolDetectorManager: { detect },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'codex',
        command: 'codex',
      });

      await expect(ctr.sendPrompt({ prompt: 'hello', sessionId })).rejects.toThrow(
        'Codex CLI was not found',
      );

      expect(detect).toHaveBeenCalledWith('codex', true);
      expect(spawnCalls).toHaveLength(0);
    });

    it('fails fast when Claude Code CLI is unavailable instead of attempting spawn', async () => {
      const detect = vi.fn().mockResolvedValue({ available: false });
      const ctr = new HeterogeneousAgentCtr({
        appStoragePath,
        storeManager: { get: vi.fn() },
        toolDetectorManager: { detect },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'claude-code',
        command: 'claude',
      });

      await expect(ctr.sendPrompt({ prompt: 'hello', sessionId })).rejects.toThrow(
        'Claude Code CLI was not found',
      );

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
        toolDetectorManager: { detect },
      } as any);
      const { sessionId } = await ctr.startSession({
        agentType: 'claude-code',
        command: 'claude-alt',
      });

      await expect(ctr.sendPrompt({ prompt: 'hello', sessionId })).rejects.toThrow(
        'Claude Code CLI was not found',
      );

      expect(detect).not.toHaveBeenCalled();
      expect(spawnCalls).toHaveLength(0);
    });

    it('passes prompt via stdin to codex exec instead of argv', async () => {
      const prompt = '--run a shell-like prompt safely';
      const { cliArgs, command, writes } = await runSendPrompt(prompt);

      expect(command).toBe('codex');
      expect(cliArgs).not.toContain(prompt);
      expect(cliArgs).toEqual(
        expect.arrayContaining(['exec', '--json', '--skip-git-repo-check', '--full-auto', '-']),
      );
      expect(writes).toEqual([prompt]);
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
      expect(cliArgs.filter((arg) => arg === '--image')).toHaveLength(2);
      expect(imagePaths).toHaveLength(2);
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

    it('skips images that fail to materialize and still forwards the remaining --image args', async () => {
      const imageList = [
        { id: 'good-image', url: 'data:image/png;base64,VkFMSURfSU1BR0U=' },
        { id: 'bad-image', url: 'bad://broken-image' },
      ];
      const { cliArgs, writes } = await runSendPrompt('inspect the valid screenshot only', {}, [], {
        imageList,
      });

      const imagePaths = getFlagValues(cliArgs, '--image');

      expect(cliArgs.filter((arg) => arg === '--image')).toHaveLength(1);
      expect(imagePaths).toHaveLength(1);
      expect(imagePaths[0]).toMatch(/\.png$/);
      await expect(readFile(imagePaths[0], 'utf8')).resolves.toBe('VALID_IMAGE');
      expect(writes).toEqual(['inspect the valid screenshot only']);
    });

    it('uses codex exec resume syntax when continuing an existing thread', async () => {
      const { cliArgs } = await runSendPrompt('continue', { resumeSessionId: 'thread_abc' });

      expect(cliArgs.slice(0, 2)).toEqual(['exec', 'resume']);
      expect(cliArgs).toContain('thread_abc');
      expect(cliArgs).not.toContain('--resume');
      expect(cliArgs.at(-1)).toBe('-');
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
});
