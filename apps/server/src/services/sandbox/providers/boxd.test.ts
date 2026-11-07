import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MarketService } from '@/server/services/market';

import { boxdToolScript, OUTPUT_LIMIT_BYTES, READ_FILE_LIMIT_CHARS } from './boxdScript';

class ConflictError extends Error {
  override name = 'ConflictError';
}

class NotFoundError extends Error {
  override name = 'NotFoundError';
}

class RateLimitError extends Error {
  override name = 'RateLimitError';
}

interface FakeMachine {
  id: string;
  name: string;
  status: string;
}

type ExecParams = {
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
};

type ExecResult = { exitCode: number; stderr: string; stdout: string };

/** The line a command runs: the model's line under the capped runner, the `sh -c` line, or the argv joined. */
const lineOf = ({ command }: ExecParams) => {
  if (command[0] === 'sh' && command[1] === '-c' && command[3] === 'lobe-exec') return command[4];
  if (command[0] === 'sh' && command[1] === '-c') return command[2];
  return command.join(' ');
};

const canRun = (program: string) => spawnSync(program, ['--version']).status === 0;
const hasShell = process.platform !== 'win32';
const hasPython = canRun('python3');

/** Runs an exec on this machine, as the computer would; the provider's own setup is a no-op. */
const runHere = async ({ command, env }: ExecParams): Promise<ExecResult> => {
  if (command[3] !== 'lobe-exec' && command[0] !== 'python3') {
    return { exitCode: 0, stderr: '', stdout: '' };
  }
  const run = spawnSync(command[0], command.slice(1), {
    cwd: tmpdir(),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  return { exitCode: run.status ?? -1, stderr: run.stderr, stdout: run.stdout };
};

/** The Python half, run here with its arguments in the environment like the provider passes them. */
const runToolScript = (operation: string, args: Record<string, unknown>) => {
  const run = spawnSync('python3', ['-c', boxdToolScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      LOBE_BOXD_ARGS: JSON.stringify(args),
      LOBE_BOXD_OPERATION: operation,
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  expect(run.status).toBe(0);
  return JSON.parse(run.stdout) as Record<string, any>;
};

const createFakeBoxd = () => {
  const machines: FakeMachine[] = [];
  let created = 0;
  const files = new Map<string, string>();
  let execImpl = async (_params: ExecParams): Promise<ExecResult> => ({
    exitCode: 0,
    stderr: '',
    stdout: '',
  });

  const find = (key: string) =>
    machines.find((machine) => machine.id === key || machine.name === key);
  const running = (id: string) => {
    const machine = find(id);
    if (!machine) throw new NotFoundError(`VM not found (region fra)`);
    if (machine.status === 'stopped') {
      throw new ConflictError(
        `VM ${machine.name} is stopped, so it won't be resumed automatically.`,
      );
    }
  };

  const api = {
    machines: {
      create: vi.fn(async (params: { name: string }) => {
        if (find(params.name)) throw new ConflictError(`name '${params.name}' is already taken`);
        created += 1;
        const machine = { id: `vm-${created}`, name: params.name, status: 'running' };
        machines.push(machine);
        return machine;
      }),
      delete: vi.fn(async (id: string) => {
        const index = machines.findIndex((machine) => machine.id === id);
        if (index >= 0) machines.splice(index, 1);
      }),
      exec: vi.fn(async (id: string, params: ExecParams) => {
        // What boxd does on a deleted computer: no error, exit -1, no output.
        if (!find(id)) return { exitCode: -1, stderr: '', stdout: '' };
        running(id);
        return execImpl(params);
      }),
      fs: {
        list: vi.fn(async (id: string, _path: string) => {
          if (!find(id)) return [];
          running(id);
          return [
            {
              isDir: false,
              mtime: new Date('2026-11-05T10:00:00Z'),
              name: 'b.txt',
              path: '/w/b.txt',
              size: 9,
            },
            {
              isDir: true,
              mtime: new Date('2026-11-05T09:00:00Z'),
              name: 'a',
              path: '/w/a',
              size: 4096,
            },
          ];
        }),
        read: vi.fn(async (id: string, path: string) => {
          running(id);
          const content = files.get(path);
          if (content === undefined) throw new Error(`${path}: No such file or directory`);
          return new TextEncoder().encode(content);
        }),
        rename: vi.fn(async (id: string, from: string, to: string) => {
          running(id);
          files.set(to, files.get(from) ?? '');
          files.delete(from);
        }),
        stat: vi.fn(async (_id: string, path: string) => {
          if (path.endsWith('/dir')) return { isDir: true, size: 4096 };
          const content = files.get(path);
          if (content === undefined) throw new Error(`${path}: No such file or directory`);
          return { isDir: false, size: Buffer.byteLength(content) };
        }),
        write: vi.fn(async (id: string, path: string, data: string) => {
          running(id);
          files.set(path, data);
          return { path };
        }),
      },
      get: vi.fn(async (key: string) => {
        const machine = find(key);
        if (!machine) throw new NotFoundError(`VM not found (region fra)`);
        return machine;
      }),
      setBotProtection: vi.fn(async () => undefined),
      setDeleteAfter: vi.fn(async () => new Date()),
      setSsh: vi.fn(async () => undefined),
      start: vi.fn(async (id: string) => {
        const machine = find(id);
        if (machine) machine.status = 'running';
      }),
      waitUntilReady: vi.fn(async (id: string) => find(id)),
    },
  };

  return {
    api,
    files,
    machines,
    setExec: (impl: typeof execImpl) => {
      execImpl = impl;
    },
  };
};

let fake: ReturnType<typeof createFakeBoxd>;
let boxdOptions: unknown[];

const mockEnv = (env: Record<string, unknown> = {}) => {
  vi.doMock('@/envs/sandbox', () => ({
    sandboxEnv: { BOXD_API_KEY: 'bxd_test', SANDBOX_PROVIDER: 'boxd', ...env },
  }));
};

const createProvider = async (options: Record<string, unknown> = {}) => {
  const { BoxdSandboxProvider } = await import('./boxd');
  return new BoxdSandboxProvider({
    marketService: {} as MarketService,
    topicId: 'topic-1',
    userId: 'user-1',
    ...options,
  });
};

/** Commands the provider ran that are not its own setup of the computer. */
const toolExecs = () =>
  fake.api.machines.exec.mock.calls
    .map(([, params]) => params as ExecParams)
    .filter((params) => !lineOf(params).includes('install -d'));

describe('BoxdSandboxProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    fake = createFakeBoxd();
    boxdOptions = [];
    vi.doMock('@boxd-sh/sdk', () => ({
      Boxd: class {
        constructor(options: unknown) {
          boxdOptions.push(options);
          return fake.api;
        }
      },
      ConflictError,
      NotFoundError,
      RateLimitError,
    }));
    mockEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('@boxd-sh/sdk');
    vi.doUnmock('@/envs/sandbox');
  });

  it('runs a command in an isolated, leased computer named after the topic', async () => {
    fake.setExec(async () => ({ exitCode: 2, stderr: 'failed\n', stdout: 'partial\n' }));
    const provider = await createProvider();

    const result = await provider.callTool('runCommand', {
      command: 'make test',
      env: { 'CI': '1', 'NOT A NAME': 'x' },
    });

    expect(result).toEqual({
      result: {
        exitCode: 2,
        output: 'partial\n',
        stderr: 'failed\n',
        stdout: 'partial\n',
        success: false,
      },
      success: true,
    });
    expect(fake.api.machines.create).toHaveBeenCalledTimes(1);
    const [params] = fake.api.machines.create.mock.calls[0] as unknown as [Record<string, any>];
    expect(params).toEqual({
      config: { autoSuspendTimeout: 300, ssh: false, vcpu: undefined },
      deleteAfter: 900,
      isolated: true,
      labels: { app: 'lobehub' },
      name: expect.stringMatching(/^lobehub-[\da-f]{20}$/),
    });
    expect(fake.api.machines.waitUntilReady).toHaveBeenCalledWith('vm-1');
    expect(fake.api.machines.setBotProtection).toHaveBeenCalledWith('vm-1', 'on');
    expect(fake.api.machines.setSsh).not.toHaveBeenCalled();
    expect(lineOf(fake.api.machines.exec.mock.calls[0][1])).toContain(
      'sudo -n install -d -o boxd -g boxd',
    );
    const [run] = toolExecs();
    expect(run.command.slice(0, 2)).toEqual(['sh', '-c']);
    expect(lineOf(run)).toBe('make test');
    expect(run).toMatchObject({
      cwd: '/home/boxd/workspace',
      env: { CI: '1' },
      timeout: 120_000,
    });
    expect(boxdOptions).toEqual([{ apiKey: 'bxd_test', baseURL: undefined, region: undefined }]);
  });

  it('keeps one computer per topic across provider instances', async () => {
    await (await createProvider()).callTool('runCommand', { command: 'echo 1' });
    await (await createProvider()).callTool('runCommand', { command: 'echo 2' });
    await (
      await createProvider({ topicId: 'topic-2' })
    ).callTool('runCommand', { command: 'echo 3' });

    expect(fake.api.machines.create).toHaveBeenCalledTimes(2);
    expect(fake.machines[0].name).not.toBe(fake.machines[1].name);
    expect(fake.api.machines.get).toHaveBeenCalledTimes(2);
  });

  it('adopts the computer another process created for the same topic', async () => {
    const first = await createProvider();
    await first.callTool('runCommand', { command: 'true' });

    vi.resetModules();
    const second = await createProvider();
    await second.callTool('runCommand', { command: 'true' });

    expect(fake.api.machines.create).toHaveBeenCalledTimes(1);
    expect(fake.api.machines.get).toHaveBeenLastCalledWith(fake.machines[0].name);
  });

  it('adopts the computer when a concurrent create wins the name', async () => {
    const provider = await createProvider();
    fake.api.machines.create.mockImplementationOnce(async (params: { name: string }) => {
      fake.machines.push({ id: 'vm-race', name: params.name, status: 'running' });
      throw new ConflictError(`name '${params.name}' is already taken`);
    });

    const result = await provider.callTool('runCommand', { command: 'true' });

    expect(result.success).toBe(true);
    expect(fake.api.machines.exec.mock.calls.every(([id]) => id === 'vm-race')).toBe(true);
  });

  it('deletes a new computer it could not close to inbound traffic', async () => {
    fake.api.machines.setBotProtection.mockRejectedValueOnce(new Error('bot protection failed'));
    const provider = await createProvider();

    const result = await provider.callTool('runCommand', { command: 'true' });

    expect(result).toMatchObject({ error: { message: 'bot protection failed' }, success: false });
    expect(fake.api.machines.delete).toHaveBeenCalledWith('vm-1');
    expect(toolExecs()).toEqual([]);
  });

  it('names the machine limit when boxd refuses a new computer', async () => {
    fake.api.machines.create.mockRejectedValueOnce(
      new RateLimitError('organization machine limit reached (2/2)'),
    );
    const provider = await createProvider();

    const result = await provider.callTool('runCommand', { command: 'true' });

    expect(result).toMatchObject({
      error: {
        message: expect.stringContaining("boxd organization's machine limit"),
        name: 'BoxdMachineLimitError',
      },
      success: false,
    });
    expect(result.error?.message).toContain('organization machine limit reached (2/2)');
    expect(result.error?.message).toContain('the last 900 seconds');
  });

  it('starts a stopped computer and runs the call again', async () => {
    const provider = await createProvider();
    await provider.callTool('runCommand', { command: 'true' });
    fake.machines[0].status = 'stopped';

    const result = await provider.callTool('runCommand', { command: 'echo back' });

    expect(result.success).toBe(true);
    expect(fake.api.machines.start).toHaveBeenCalledWith('vm-1');
    expect(lineOf(toolExecs().at(-1)!)).toBe('echo back');
  });

  it('replaces a computer deleted mid-session, where exec exits -1 instead of failing', async () => {
    const provider = await createProvider();
    await provider.callTool('runCommand', { command: 'true' });
    fake.machines.splice(0, 1);

    const result = await provider.callTool('runCommand', { command: 'echo again' });

    expect(result).toMatchObject({ sessionExpiredAndRecreated: true, success: true });
    expect(fake.api.machines.create).toHaveBeenCalledTimes(2);
  });

  it('checks the computer once a minute and replaces one whose lease ran out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
    const provider = await createProvider();
    await provider.callTool('runCommand', { command: 'true' });
    fake.machines.splice(0, 1);

    vi.setSystemTime(new Date('2026-11-05T10:01:01Z'));
    const result = await provider.callTool('listFiles', { directoryPath: '.' });

    expect(result).toMatchObject({ result: { totalCount: 2 }, sessionExpiredAndRecreated: true });
    expect(fake.api.machines.get).toHaveBeenCalledWith('vm-1');
    expect(fake.api.machines.fs.list).toHaveBeenLastCalledWith('vm-2', '/home/boxd/workspace');
  });

  it('deletes and replaces a computer that failed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
    const provider = await createProvider();
    await provider.callTool('runCommand', { command: 'true' });
    fake.machines[0].status = 'failed';

    vi.setSystemTime(new Date('2026-11-05T10:01:01Z'));
    const result = await provider.callTool('runCommand', { command: 'true' });

    expect(result).toMatchObject({ sessionExpiredAndRecreated: true, success: true });
    expect(fake.api.machines.delete).toHaveBeenCalledWith('vm-1');
    expect(fake.api.machines.setDeleteAfter).not.toHaveBeenCalledWith('vm-1', expect.anything());
    expect(toolExecs().at(-1)).toBeDefined();
    expect(fake.api.machines.exec.mock.calls.at(-1)![0]).toBe('vm-2');
  });

  it('extends the lease at most once a minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'));
    const provider = await createProvider();

    await provider.callTool('runCommand', { command: 'true' });
    await provider.callTool('runCommand', { command: 'true' });
    expect(fake.api.machines.setDeleteAfter).not.toHaveBeenCalled();

    vi.setSystemTime(new Date('2026-11-05T10:01:01Z'));
    await provider.callTool('runCommand', { command: 'true' });
    await provider.callTool('runCommand', { command: 'true' });

    expect(fake.api.machines.setDeleteAfter).toHaveBeenCalledTimes(1);
    expect(fake.api.machines.setDeleteAfter).toHaveBeenCalledWith('vm-1', 900);
  });

  it('prepares the computer again on the next call when setup failed', async () => {
    fake.setExec(async (params) =>
      lineOf(params).includes('install -d')
        ? { exitCode: 1, stderr: 'sudo: a password is required\n', stdout: '' }
        : { exitCode: 0, stderr: '', stdout: '' },
    );
    const provider = await createProvider();

    await provider.callTool('runCommand', { command: 'true' });
    await provider.callTool('runCommand', { command: 'true' });

    const setups = fake.api.machines.exec.mock.calls.filter(([, params]) =>
      lineOf(params as ExecParams).includes('install -d'),
    );
    expect(setups).toHaveLength(2);
  });

  it('turns an exec timeout into exit code 124 the model can read', async () => {
    fake.setExec(async (params) => {
      if (lineOf(params) === 'sleep 60') throw new Error('exec timed out after 1000ms');
      return { exitCode: 0, stderr: '', stdout: '' };
    });
    const provider = await createProvider();

    const result = await provider.callTool('runCommand', { command: 'sleep 60', timeout: 1000 });

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ exitCode: 124, success: false });
    expect(String(result.result?.stderr)).toContain('background: true');
  });

  it('fails with a configuration error and no client when BOXD_API_KEY is missing', async () => {
    vi.doMock('@/envs/sandbox', () => ({ sandboxEnv: { SANDBOX_PROVIDER: 'boxd' } }));
    const provider = await createProvider();

    const result = await provider.callTool('runCommand', { command: 'true' });
    const exported = await provider.exportFileToUploadUrl({
      filename: 'a.txt',
      path: 'a.txt',
      uploadUrl: 'https://s3.example.com/a',
    });

    expect(result).toMatchObject({
      error: { message: expect.stringContaining('BOXD_API_KEY') },
      success: false,
    });
    expect(exported).toMatchObject({
      error: { message: expect.stringContaining('BOXD_API_KEY') },
      success: false,
    });
    expect(boxdOptions).toHaveLength(0);
  });

  it('passes region, endpoint and snapshot through to boxd and turns SSH off after a restore', async () => {
    mockEnv({
      BOXD_BASE_URL: 'https://boxd.example.com',
      BOXD_REGION: 'nyc',
      BOXD_SNAPSHOT: 'lobehub-base',
      BOXD_VCPU: 4,
    });
    const provider = await createProvider();

    await provider.callTool('runCommand', { command: 'true' });

    expect(boxdOptions).toEqual([
      { apiKey: 'bxd_test', baseURL: 'https://boxd.example.com', region: 'nyc' },
    ]);
    const [params] = fake.api.machines.create.mock.calls[0] as unknown as [Record<string, any>];
    expect(params).toMatchObject({ fromSnapshot: 'lobehub-base', isolated: true });
    expect(params.config).toEqual({ autoSuspendTimeout: 300 });
    expect(fake.api.machines.setSsh).toHaveBeenCalledWith('vm-1', false);
    expect(fake.api.machines.setBotProtection).toHaveBeenCalledWith('vm-1', 'on');
  });

  it('runs drive and persistent runs on the topic computer, leased like any other', async () => {
    const drive = await createProvider({ sandboxCwd: 'reports', sandboxMode: 'drive' });
    const persistent = await createProvider({
      sandboxInstanceId: 'env-1',
      sandboxMode: 'persistent',
      topicId: 'topic-2',
    });

    await drive.callTool('runCommand', { command: 'pwd' });
    await persistent.callTool('runCommand', { command: 'pwd' });

    expect(fake.api.machines.create).toHaveBeenCalledTimes(2);
    for (const [params] of fake.api.machines.create.mock.calls as unknown as [
      Record<string, any>,
    ][]) {
      expect(params.deleteAfter).toBe(900);
    }
    expect(toolExecs().map((call) => call.cwd)).toEqual([
      '/home/boxd/workspace',
      '/home/boxd/workspace',
    ]);
  });

  it('keeps leases off when BOXD_LEASE_TTL_SEC is 0', async () => {
    mockEnv({ BOXD_LEASE_TTL_SEC: 0 });
    const provider = await createProvider();

    await provider.callTool('runCommand', { command: 'true' });

    const [params] = fake.api.machines.create.mock.calls[0] as unknown as [Record<string, any>];
    expect(params.deleteAfter).toBeUndefined();
  });

  it('starts a background command in its own session and polls it through the computer', async () => {
    const provider = await createProvider();

    const started = await provider.callTool('runCommand', {
      background: true,
      command: 'npm run dev',
    });
    const commandId = String(started.result?.commandId);

    expect(started).toMatchObject({ result: { running: true }, success: true });
    expect(commandId).toMatch(/^cmd_[\da-f]{16}$/);
    expect(fake.files.get(`/tmp/lobe-commands/${commandId}/command.sh`)).toBe('npm run dev');
    expect(lineOf(toolExecs()[0])).toMatch(
      /^setsid sh -c .* lobe-command '\/tmp\/lobe-commands\/cmd_/,
    );

    fake.setExec(async () => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({ newOutput: 'ready\n', running: true, stderr: '', success: true }),
    }));
    const output = await provider.callTool('getCommandOutput', { commandId });

    expect(output).toEqual({
      result: { newOutput: 'ready\n', running: true, stderr: '', success: true },
      success: true,
    });
    const poll = toolExecs().at(-1)!;
    expect(poll.env?.LOBE_BOXD_OPERATION).toBe('output');
    expect(JSON.parse(poll.env!.LOBE_BOXD_ARGS)).toEqual({
      dir: `/tmp/lobe-commands/${commandId}`,
    });
  });

  it('reports a background command that did not start', async () => {
    fake.setExec(async (params) =>
      lineOf(params).startsWith('setsid')
        ? { exitCode: 2, stderr: "sh: 1: cd: can't cd to /home/boxd/workspace/nope\n", stdout: '' }
        : { exitCode: 0, stderr: '', stdout: '' },
    );
    const provider = await createProvider();

    const started = await provider.callTool('runCommand', {
      background: true,
      command: 'npm run dev',
      cwd: 'nope',
    });

    expect(started).toMatchObject({
      error: { message: expect.stringContaining("can't cd") },
      success: false,
    });
  });

  it('refuses command ids it did not issue', async () => {
    const provider = await createProvider();

    const output = await provider.callTool('getCommandOutput', { commandId: '../../etc' });
    const killed = await provider.callTool('killCommand', { commandId: 'cmd_x; rm -rf /' });

    expect(output.success).toBe(false);
    expect(killed.success).toBe(false);
    expect(fake.api.machines.create).not.toHaveBeenCalled();
  });

  it('reads a line window and reports the whole file', async () => {
    const provider = await createProvider();
    fake.files.set('/home/boxd/workspace/notes.md', 'one\ntwo\nthree\nfour\n');

    const result = await provider.callTool('readFile', {
      endLine: 3,
      path: 'notes.md',
      startLine: 2,
    });

    expect(result).toEqual({
      result: {
        charCount: 10,
        content: 'two\nthree\n',
        filename: 'notes.md',
        totalCharCount: 19,
        totalLineCount: 4,
      },
      success: true,
    });
  });

  it('windows a file over the read cap inside the computer instead of reading it whole', async () => {
    const provider = await createProvider();
    fake.files.set('/home/boxd/workspace/big.log', 'x'.repeat(READ_FILE_LIMIT_CHARS + 1));
    fake.setExec(async (params) =>
      params.env?.LOBE_BOXD_OPERATION === 'read'
        ? { exitCode: 0, stderr: '', stdout: JSON.stringify({ content: 'x', truncated: true }) }
        : { exitCode: 0, stderr: '', stdout: '' },
    );

    const result = await provider.callTool('readFile', { path: 'big.log', startLine: 10 });

    expect(result).toEqual({ result: { content: 'x', truncated: true }, success: true });
    expect(fake.api.machines.fs.read).not.toHaveBeenCalled();
    expect(JSON.parse(toolExecs().at(-1)!.env!.LOBE_BOXD_ARGS)).toEqual({
      limit: READ_FILE_LIMIT_CHARS,
      path: '/home/boxd/workspace/big.log',
      startLine: 10,
    });
  });

  it('writes, edits and renames files through the file API', async () => {
    const provider = await createProvider();

    await provider.callTool('writeLocalFile', { content: 'a-a-a', path: 'out/x.txt' });
    const first = await provider.callTool('editLocalFile', {
      path: 'out/x.txt',
      replace: 'b',
      search: 'a',
    });
    const all = await provider.callTool('editFile', {
      all: true,
      path: 'out/x.txt',
      replace: 'c',
      search: 'a',
    });
    const missing = await provider.callTool('editFile', {
      path: 'out/x.txt',
      replace: 'd',
      search: 'zzz',
    });
    const renamed = await provider.callTool('renameLocalFile', {
      newName: 'y.txt',
      oldPath: 'out/x.txt',
    });

    expect(first.result).toMatchObject({ replacements: 1 });
    expect(all.result).toMatchObject({ replacements: 2 });
    expect(missing).toMatchObject({ error: { message: 'search text not found' }, success: false });
    expect(renamed.result).toEqual({ newPath: '/home/boxd/workspace/out/y.txt', success: true });
    expect(fake.files.get('/home/boxd/workspace/out/y.txt')).toBe('b-c-c');
  });

  it('moves a file into a directory destination', async () => {
    const provider = await createProvider();
    fake.files.set('/home/boxd/workspace/a.txt', 'x');

    const result = await provider.callTool('moveFiles', {
      operations: [{ destination: 'dir', source: 'a.txt' }],
    });

    expect(result.result).toEqual({
      results: [
        {
          destination: '/home/boxd/workspace/dir/a.txt',
          source: '/home/boxd/workspace/a.txt',
          success: true,
        },
      ],
      successCount: 1,
    });
  });

  it('lists a directory sorted by name with sizes and times', async () => {
    const provider = await createProvider();

    const result = await provider.callTool('listLocalFiles', { directoryPath: '.' });

    expect(result.result?.totalCount).toBe(2);
    expect((result.result?.files as { name: string }[]).map((file) => file.name)).toEqual([
      'a',
      'b.txt',
    ]);
    expect(fake.api.machines.fs.list).toHaveBeenCalledWith('vm-1', '/home/boxd/workspace');
  });

  it('runs code from a file the file API wrote', async () => {
    fake.setExec(async (params) =>
      lineOf(params).startsWith('python3 ')
        ? { exitCode: 0, stderr: '', stdout: '42\n' }
        : { exitCode: 0, stderr: '', stdout: '' },
    );
    const provider = await createProvider();

    const result = await provider.callTool('executeCode', {
      code: 'print(6*7)',
      language: 'python',
    });

    expect(result).toEqual({
      result: { error: undefined, exitCode: 0, output: '42\n', stderr: '' },
      success: true,
    });
    const [path] = [...fake.files.keys()];
    expect(path).toMatch(/^\/tmp\/lobe-code\/[\da-f]{12}\.py$/);
    expect(fake.files.get(path)).toBe('print(6*7)');
  });

  it('runs a skill command from its unpacked archive', async () => {
    const provider = await createProvider();

    await provider.callTool('execScript', {
      activatedSkills: [{ name: 'pdf' }],
      command: 'python3 run.py',
      skillZipUrls: { pdf: 'https://cdn.example.com/pdf.zip' },
    });

    const [setup, run] = toolExecs();
    expect(lineOf(setup)).toContain("curl -fsSL 'https://cdn.example.com/pdf.zip'");
    expect(lineOf(run)).toBe('python3 run.py');
    expect(run.cwd).toMatch(/^\/tmp\/lobe-skills\/[\da-f]{32}\/pdf$/);
  });

  it('uploads exports from inside the computer without putting the URL on the command line', async () => {
    fake.setExec(async ({ env }) =>
      env?.LOBE_BOXD_OPERATION === 'export'
        ? {
            exitCode: 0,
            stderr: '',
            stdout: JSON.stringify({ mimeType: 'text/csv', size: 12, status: 200, success: true }),
          }
        : { exitCode: 0, stderr: '', stdout: '' },
    );
    const provider = await createProvider();

    const result = await provider.exportFileToUploadUrl({
      filename: 'report.csv',
      path: 'report.csv',
      uploadHeaders: { 'Content-Type': 'text/csv' },
      uploadUrl: 'https://s3.example.com/bucket/report.csv?X-Amz-Signature=secret',
    });

    expect(result).toMatchObject({ mimeType: 'text/csv', size: 12, success: true });
    const call = toolExecs().at(-1)!;
    expect(call.command.slice(0, 2)).toEqual(['python3', '-c']);
    expect(call.command.join(' ')).not.toContain('X-Amz-Signature');
    // Longer than the 300 s the upload itself may take inside the computer.
    expect(call.timeout).toBe(330_000);
    expect(JSON.parse(call.env!.LOBE_BOXD_ARGS)).toEqual({
      headers: { 'Content-Type': 'text/csv' },
      path: '/home/boxd/workspace/report.csv',
      url: 'https://s3.example.com/bucket/report.csv?X-Amz-Signature=secret',
    });
  });

  it('reports an unsupported tool', async () => {
    const provider = await createProvider();

    const result = await provider.callTool('teleport', {});

    expect(result).toMatchObject({
      error: { message: 'Unsupported boxd sandbox tool: teleport' },
      success: false,
    });
  });

  describe.skipIf(!hasShell)('output caps, with the runner run on this machine', () => {
    it('cuts a 10 MB stdout to its head and tail inside the computer and reports the full size', async () => {
      fake.setExec(runHere);
      const provider = await createProvider();

      const result = await provider.callTool('runCommand', {
        command:
          "head -c 10000000 /dev/zero | tr '\\0' a; printf 'tail-end'; echo done >&2; exit 3",
      });

      const output = result.result as Record<string, any>;
      expect(result.success).toBe(true);
      expect(output).toMatchObject({
        exitCode: 3,
        stderr: 'done\n',
        stderrBytes: 5,
        stdoutBytes: 10_000_008,
        success: false,
        truncated: true,
      });
      expect(output.stdout.length).toBeLessThan(OUTPUT_LIMIT_BYTES + 100);
      expect(output.stdout.startsWith('aaaa')).toBe(true);
      expect(output.stdout.endsWith('tail-end')).toBe(true);
      expect(output.stdout).toContain(
        `[... ${10_000_008 - OUTPUT_LIMIT_BYTES} bytes of output left out ...]`,
      );
      expect(output.output).toBe(output.stdout);
    });

    it('returns small output unchanged and keeps the exit code', async () => {
      fake.setExec(runHere);
      const provider = await createProvider();

      const result = await provider.callTool('runCommand', {
        command: 'printf "hi\\n"; printf "warn\\n" >&2; exit 1',
      });

      expect(result.result).toEqual({
        exitCode: 1,
        output: 'hi\n',
        stderr: 'warn\n',
        stdout: 'hi\n',
        success: false,
      });
    });
  });

  describe.skipIf(!hasPython)('the Python half, run on this machine', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'boxd-test-'));
    });

    afterEach(() => {
      rmSync(dir, { force: true, recursive: true });
    });

    it('returns background output in capped polls that end on whole characters', () => {
      const text = '€'.repeat(300_000);
      writeFileSync(path.join(dir, 'stdout'), text);
      writeFileSync(path.join(dir, 'stderr'), '');
      writeFileSync(path.join(dir, 'command.sh'), 'true');
      writeFileSync(path.join(dir, 'pid'), String(process.pid));

      const polls = [];
      for (let poll = 0; poll < 6; poll += 1) polls.push(runToolScript('output', { dir }));

      const first = polls[0];
      expect(Buffer.byteLength(first.newOutput.split('\n[More output')[0])).toBeLessThanOrEqual(
        OUTPUT_LIMIT_BYTES,
      );
      expect(first).toMatchObject({ running: true, truncated: true });
      expect(first.newOutput).toContain('[More output is waiting: call getCommandOutput again.]');
      const joined = polls
        .map((poll) =>
          poll.newOutput.replace('\n[More output is waiting: call getCommandOutput again.]', ''),
        )
        .join('');
      expect(joined).toBe(text);
      expect(joined).not.toContain('�');
      expect(polls.at(-1)!.truncated).toBe(false);
    });

    it('reports a command whose runner never wrote a pid as not running', () => {
      writeFileSync(path.join(dir, 'command.sh'), 'true');
      const old = new Date(Date.now() - 60_000);
      utimesSync(path.join(dir, 'command.sh'), old, old);

      expect(runToolScript('output', { dir })).toMatchObject({
        error: 'The command did not start',
        running: false,
      });
    });

    it('windows a large file at a line and the character cap, and counts the whole file', () => {
      const file = path.join(dir, 'big.txt');
      const line = `${'y'.repeat(999)}\n`;
      writeFileSync(file, line.repeat(1000));

      const all = runToolScript('read', { limit: READ_FILE_LIMIT_CHARS, path: file });
      const window = runToolScript('read', {
        endLine: 12,
        limit: READ_FILE_LIMIT_CHARS,
        path: file,
        startLine: 11,
      });

      expect(all).toMatchObject({
        totalCharCount: 1_000_000,
        totalLineCount: 1000,
        truncated: true,
      });
      expect(all.content.startsWith(line.repeat(500))).toBe(true);
      expect(all.content).toContain('[Truncated at 500000 characters. The file has 1000 lines');
      expect(window).toMatchObject({ content: line.repeat(2), truncated: false });
    });

    it('keeps grep results to a default count and the output cap', () => {
      writeFileSync(path.join(dir, 'many.txt'), 'match\n'.repeat(2000));
      writeFileSync(path.join(dir, 'wide.txt'), `match${'z'.repeat(1_000_000)}\n`);

      const result = runToolScript('grep', { directory: dir, pattern: 'match' });

      expect(result.totalMatches).toBe(2001);
      expect(result.matches).toHaveLength(500);
      expect(result.truncated).toBe(true);
      for (const match of result.matches) expect(match.content.length).toBeLessThanOrEqual(2000);
    });
  });
});
