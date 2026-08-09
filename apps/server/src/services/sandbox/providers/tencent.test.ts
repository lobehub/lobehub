// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { promisify } from 'node:util';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    TENCENT_SANDBOX_API_BASE: undefined as string | undefined,
    TENCENT_SANDBOX_API_TOKEN: 'test-token' as string | undefined,
    TENCENT_SANDBOX_MODE: 'persistent' as string,
    TENCENT_SANDBOX_PROJECT_ID: 'makers-test' as string | undefined,
    TENCENT_SANDBOX_REGION: undefined as string | undefined,
    TENCENT_SANDBOX_TIMEOUT_SEC: undefined as number | undefined,
  },
  sandbox: {
    commands: { connect: vi.fn(), kill: vi.fn(), run: vi.fn() },
    files: { read: vi.fn(), write: vi.fn() },
    runCode: vi.fn(),
  },
}));

vi.mock('@/envs/sandbox', () => ({ sandboxEnv: mocks.env }));
vi.mock('@e2b/code-interpreter', () => ({ Sandbox: vi.fn(() => mocks.sandbox) }));

const options = { marketService: {} as never, topicId: 'topic-1', userId: 'user-1' };

const execFileAsync = promisify(execFile);
const calls = { acquire: 0, release: 0, update: 0 };
/** Seconds until the acquired instance expires; drives the renewal path. */
let expiresInSec = 300;

const installFetch = () => {
  calls.acquire = 0;
  calls.release = 0;
  calls.update = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const action = url.split('/').pop() as keyof typeof calls;
      calls[action] += 1;

      return {
        json: async () => ({
          Code: 0,
          Data: {
            InstanceExpiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
            InstanceId: `instance-${calls.acquire}`,
            SandboxDomain: 'ap-beijing.tencentags.com',
            Token: 'sit_test',
          },
        }),
        ok: true,
      };
    }),
  );
};

const load = async () => {
  vi.resetModules();
  const { TencentSandboxProvider, __clearSandboxInstances } = await import('./tencent');
  __clearSandboxInstances();

  return new TencentSandboxProvider(options);
};

/** Decodes the base64 argument blob the shared Python helpers receive. */
const scriptArgs = (command: string) => {
  const encoded = /main\('([^']+)'\)/.exec(command)?.[1];

  return JSON.parse(Buffer.from(encoded!, 'base64').toString());
};

const okCommand = (stdout = '') => ({ exitCode: 0, stderr: '', stdout });

describe('TencentSandboxProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.TENCENT_SANDBOX_API_TOKEN = 'test-token';
    mocks.env.TENCENT_SANDBOX_PROJECT_ID = 'makers-test';
    mocks.env.TENCENT_SANDBOX_MODE = 'persistent';
    expiresInSec = 300;
    installFetch();
  });

  it('fails fast when credentials are missing', async () => {
    mocks.env.TENCENT_SANDBOX_API_TOKEN = undefined;

    const result = await (await load()).callTool('executeCode', { code: 'print(1)' });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('TENCENT_SANDBOX_API_TOKEN');
    expect(calls.acquire).toBe(0);
  });

  // The execution card reads `output`, and takes its status from the outer
  // envelope rather than anything nested in the payload.
  it('maps executed code to the fields the runtime renders', async () => {
    mocks.sandbox.runCode.mockResolvedValue({
      logs: { stderr: [], stdout: ['42\n'] },
      results: [],
    });

    const result = await (await load()).callTool('executeCode', { code: 'print(42)' });

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ output: '42\n', stdout: '42\n' });
  });

  it('fails the call when the executed code raises', async () => {
    mocks.sandbox.runCode.mockResolvedValue({
      error: { value: 'ZeroDivisionError' },
      logs: { stderr: ['boom'], stdout: [] },
      results: [],
    });

    const result = await (await load()).callTool('executeCode', { code: '1/0' });

    expect(result.success).toBe(false);
    // The runtime builds the model-visible content from the outer error.
    expect(result.error?.message).toBe('ZeroDivisionError');
    // The payload still has to reach the runtime so the card can show it.
    expect(result.result).toMatchObject({ error: 'ZeroDivisionError', stderr: 'boom' });
  });

  // The runtime falls back to the outer envelope when the command result has no
  // `success`, which would report a failed install as a successful one.
  it('marks a nonzero command exit as a failed command', async () => {
    mocks.sandbox.commands.run.mockResolvedValue({
      exitCode: 1,
      stderr: 'boom',
      stdout: '',
    });

    const result = await (await load()).callTool('runCommand', { command: 'false' });

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ exitCode: 1, success: false });
  });

  it('detaches background commands and returns a pollable identifier', async () => {
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    const result = await (
      await load()
    ).callTool('runCommand', {
      background: true,
      command: 'sleep 60',
    });

    const { commandId, shell_id } = result.result as Record<string, string>;
    expect(commandId).toBeTruthy();
    expect(shell_id).toBe(commandId);

    // Output has to be captured on disk, otherwise later polls have nothing to
    // read without waiting for the process to finish.
    const [launch] = mocks.sandbox.commands.run.mock.calls[0];
    expect(launch).toContain(`${commandId}.log`);
    expect(launch).toContain(`${commandId}.pid`);
  });

  // A command carrying its own quotes must survive the launcher untouched —
  // interpolating it into `sh -c '...'` would terminate the wrapper's quoting.
  it('runs a quoted background command without mangling it', async () => {
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    const command = `printf '%s\\n' 'hello world'`;
    const result = await (
      await load()
    ).callTool('runCommand', {
      background: true,
      command,
      timeout: 5000,
    });

    const { commandId } = result.result as Record<string, string>;
    // The command travels as a file, so the launcher never sees its quotes.
    expect(mocks.sandbox.files.write).toHaveBeenCalledWith(
      expect.stringContaining(`${commandId}.sh`),
      command,
    );

    const [launch] = mocks.sandbox.commands.run.mock.calls[0];
    expect(launch).not.toContain('hello world');
    // The detached process gets the timeout, not just the launcher, and
    // timeout's own pid/group is the one we record and later kill.
    expect(launch).toContain('timeout --kill-after=5s 5s');
    expect(launch).toContain('command_pgid=$!');
    // Without detaching every fd the caller waits for the background process.
    expect(launch).toContain('< /dev/null > /dev/null 2>&1');
  });

  it.runIf(process.platform === 'linux')(
    'kills the entire background process group when it times out',
    async () => {
      const childPidFile = `/tmp/lobe-background/test-child-${process.pid}-${Date.now()}.pid`;

      mocks.sandbox.files.write.mockImplementation(async (path: string, content: string) => {
        await mkdir(nodePath.dirname(path), { recursive: true });
        await writeFile(path, content);
      });
      mocks.sandbox.commands.run.mockImplementation(async (command: string) => {
        const { stderr, stdout } = await execFileAsync('sh', ['-c', command], {
          encoding: 'utf8',
        });

        return { exitCode: 0, stderr, stdout };
      });

      const result = await (
        await load()
      ).callTool('runCommand', {
        background: true,
        command: `sleep 60 & echo $! > ${childPidFile}; wait`,
        timeout: 1000,
      });
      const { commandId } = result.result as Record<string, string>;
      const base = `/tmp/lobe-background/${commandId}`;

      try {
        await vi.waitFor(
          async () => {
            expect((await readFile(`${base}.exit`, 'utf8')).trim()).toBe('124');
          },
          { interval: 50, timeout: 5000 },
        );

        const childPid = Number((await readFile(childPidFile, 'utf8')).trim());
        await vi.waitFor(
          () => {
            expect(() => process.kill(childPid, 0)).toThrow();
          },
          { interval: 50, timeout: 2000 },
        );
      } finally {
        try {
          const pgid = Number((await readFile(`${base}.pgid`, 'utf8')).trim());
          process.kill(-pgid, 'SIGKILL');
        } catch {
          // The timeout normally removed the group already.
        }

        try {
          const childPid = Number((await readFile(childPidFile, 'utf8')).trim());
          process.kill(childPid, 'SIGKILL');
        } catch {
          // The expected path: the child is already gone.
        }

        await Promise.all(
          ['sh', 'log', 'pid', 'pgid', 'exit', 'off'].map((suffix) =>
            rm(`${base}.${suffix}`, { force: true }),
          ),
        );
        await rm(childPidFile, { force: true });
      }
    },
  );

  // The tool contract polls for new output while the process keeps running, so
  // this must never block on completion.
  it('reports background progress without waiting for the process to exit', async () => {
    mocks.sandbox.commands.run.mockResolvedValue(
      okCommand(JSON.stringify({ newOutput: 'tick\n', running: true, success: true })),
    );

    const result = await (await load()).callTool('getCommandOutput', { commandId: 'abc' });

    expect(result.result).toMatchObject({ newOutput: 'tick\n', running: true });
    expect(mocks.sandbox.commands.connect).not.toHaveBeenCalled();
  });

  it('forwards the requested command timeout', async () => {
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    await (await load()).callTool('runCommand', { command: 'sleep 1', timeout: 5000 });

    expect(mocks.sandbox.commands.run).toHaveBeenCalledWith(
      'sleep 1',
      expect.objectContaining({ timeoutMs: 5000 }),
    );
  });

  it('kills a background command by its identifier', async () => {
    mocks.sandbox.commands.run.mockResolvedValue(okCommand(JSON.stringify({ success: true })));

    const result = await (await load()).callTool('killCommand', { commandId: 'abc' });

    expect(result.success).toBe(true);
    expect(scriptArgs(mocks.sandbox.commands.run.mock.calls[0][0])).toEqual({ commandId: 'abc' });
  });

  // The shared tool contract uses `directoryPath`, not `path`.
  it('passes file tool arguments through to the shared script unchanged', async () => {
    mocks.sandbox.commands.run.mockResolvedValue(
      okCommand(JSON.stringify({ files: [{ isDirectory: false, name: 'a.txt' }], totalCount: 1 })),
    );

    const result = await (await load()).callTool('listLocalFiles', { directoryPath: '/mnt/data' });

    const [command] = mocks.sandbox.commands.run.mock.calls[0];
    expect(scriptArgs(command)).toEqual({ directoryPath: '/mnt/data' });
    expect(result.result).toMatchObject({ files: [{ isDirectory: false, name: 'a.txt' }] });
  });

  it('surfaces a script-reported failure as a failed call', async () => {
    mocks.sandbox.commands.run.mockResolvedValue(
      okCommand(JSON.stringify({ error: 'search text not found', success: false })),
    );

    const result = await (
      await load()
    ).callTool('editLocalFile', {
      path: '/a.txt',
      replace: 'b',
      search: 'a',
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('search text not found');
  });

  // File bootstrapping issues a command before the requested tool runs; both
  // must land in the same container.
  it('reuses one instance across calls in every mode', async () => {
    for (const mode of ['persistent', 'on-demand']) {
      mocks.env.TENCENT_SANDBOX_MODE = mode;
      installFetch();
      mocks.sandbox.commands.run.mockResolvedValue(okCommand());

      const provider = await load();
      await provider.callTool('runCommand', { command: 'echo 1' });
      await provider.callTool('runCommand', { command: 'echo 2' });

      expect(calls.acquire, mode).toBe(1);
      expect(calls.release, mode).toBe(0);
    }
  });

  it('renews a persistent instance that is close to expiring', async () => {
    expiresInSec = 10;
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    const provider = await load();
    await provider.callTool('runCommand', { command: 'echo 1' });
    await provider.callTool('runCommand', { command: 'echo 2' });

    expect(calls.update).toBe(1);
    expect(calls.acquire).toBe(1);
  });

  // Dropping a still-valid instance early would strand uploaded files and
  // background processes mid-session.
  it('keeps an on-demand instance until it actually expires', async () => {
    mocks.env.TENCENT_SANDBOX_MODE = 'on-demand';
    expiresInSec = 10;
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    const provider = await load();
    await provider.callTool('runCommand', { command: 'echo 1' });
    await provider.callTool('runCommand', { command: 'echo 2' });

    expect(calls.update).toBe(0);
    expect(calls.release).toBe(0);
    expect(calls.acquire).toBe(1);
  });

  it('shares one instance between concurrent calls for the same session', async () => {
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    const provider = await load();
    await Promise.all([
      provider.callTool('runCommand', { command: 'echo 1' }),
      provider.callTool('runCommand', { command: 'echo 2' }),
    ]);

    expect(calls.acquire).toBe(1);
  });

  it('reports unsupported tools as a failed call', async () => {
    const result = await (await load()).callTool('notARealTool', {});

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('notARealTool');
  });

  it('reports capabilities that match the configured mode', async () => {
    mocks.env.TENCENT_SANDBOX_MODE = 'on-demand';

    expect((await load()).capabilities.persistentSession).toBe(false);
  });

  // Reading the artifact into the Node process first would let a large export
  // exhaust server memory, so the upload has to happen inside the sandbox.
  it('uploads exported files from inside the sandbox', async () => {
    mocks.sandbox.commands.run.mockResolvedValue(
      okCommand(JSON.stringify({ size: 4096, status: 200, success: true })),
    );

    const result = await (
      await load()
    ).exportFileToUploadUrl({
      filename: 'chart.png',
      path: '/mnt/data/chart.png',
      uploadHeaders: { 'x-cos-acl': 'private' },
      uploadUrl: 'https://example.com/upload',
    });

    expect(result).toMatchObject({ size: 4096, success: true });
    expect(mocks.sandbox.files.read).not.toHaveBeenCalled();
    expect(scriptArgs(mocks.sandbox.commands.run.mock.calls[0][0])).toEqual({
      headers: { 'x-cos-acl': 'private' },
      path: '/mnt/data/chart.png',
      uploadUrl: 'https://example.com/upload',
    });
  });
});
