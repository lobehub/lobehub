import { EventEmitter } from 'node:events';
import { access, mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

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
vi.mock('node:child_process', () => ({
  spawn: (command: string, args: string[], options: any) => {
    spawnCalls.push({ args, command, options });
    return nextFakeProc;
  },
}));

/**
 * Build a fake ChildProcess that immediately exits cleanly. Records every
 * stdin write on the returned `writes` array so tests can inspect the payload.
 */
const createFakeProc = () => {
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
  // Exit asynchronously so the Promise returned by sendPrompt resolves cleanly.
  setImmediate(() => {
    stdout.end();
    stderr.end();
    proc.emit('exit', 0);
  });
  return { proc, writes };
};

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
    });

    const runSendPrompt = async (prompt: string, sessionOverrides: Record<string, any> = {}) => {
      const { proc, writes } = createFakeProc();
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
      return { cliArgs, command, options, writes };
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
  });
});
