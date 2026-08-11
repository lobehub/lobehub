// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { CloudSandboxExecutionRuntime } from '@lobechat/builtin-tool-cloud-sandbox/executionRuntime';
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
const TEST_COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000';
const calls = { acquire: 0, release: 0, update: 0 };
const controlPlaneRequests: { action: keyof typeof calls; payload: Record<string, unknown> }[] = [];
/** Seconds until the acquired instance expires; drives the renewal path. */
let expiresInSec = 300;

const fetchUrl = (input: string | URL | Request) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const controlPlaneResponse = (data: Record<string, unknown>) =>
  new Response(JSON.stringify({ Code: 0, Data: data }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });

const installFetch = () => {
  calls.acquire = 0;
  calls.release = 0;
  calls.update = 0;
  controlPlaneRequests.length = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const action = fetchUrl(input).split('/').pop() as keyof typeof calls;
      calls[action] += 1;
      controlPlaneRequests.push({
        action,
        payload: JSON.parse(String(init?.body || '{}')),
      });

      return controlPlaneResponse({
        InstanceExpiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
        InstanceId: `instance-${calls.acquire}`,
        SandboxDomain: 'ap-beijing.tencentags.com',
        Token: 'sit_test',
      });
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

const isLinuxProcessTerminated = async (pid: number) => {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const nameEnd = stat.lastIndexOf(')');
    const state = stat.slice(nameEnd + 2, nameEnd + 3);

    // A zombie has exited and cannot execute any more code. It may remain in
    // /proc until the container's PID 1 reaps it, so kill(pid, 0) alone is not
    // a portable termination check inside CI containers.
    return state === 'Z';
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return true;

    throw error;
  }
};

const isLinuxSessionTerminated = async (sid: number) => {
  const { stdout } = await execFileAsync('ps', ['-eo', 'sid=,stat='], { encoding: 'utf8' });

  return !stdout.split('\n').some((line) => {
    const [sessionId, state] = line.trim().split(/\s+/);

    return Number(sessionId) === sid && state !== undefined && !state.startsWith('Z');
  });
};

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

  it('maps JavaScript to the E2B js kernel', async () => {
    mocks.sandbox.runCode.mockResolvedValue({
      logs: { stderr: [], stdout: ['42\n'] },
      results: [],
    });

    await (
      await load()
    ).callTool('executeCode', {
      code: 'console.log(42)',
      language: 'javascript',
    });

    expect(mocks.sandbox.runCode).toHaveBeenCalledWith('console.log(42)', { language: 'js' });
  });

  it('executes TypeScript with the pinned tsx runner', async () => {
    mocks.sandbox.commands.run
      .mockResolvedValueOnce(okCommand('42\n'))
      .mockResolvedValueOnce(okCommand());
    const code = 'const answer: number = 42; console.log(answer);';

    const result = await (
      await load()
    ).callTool('executeCode', {
      code,
      language: 'typescript',
    });

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ output: '42\n', stdout: '42\n' });
    expect(mocks.sandbox.runCode).not.toHaveBeenCalled();
    expect(mocks.sandbox.files.write).toHaveBeenCalledWith(
      expect.stringMatching(/^\/home\/user\/\.lobe-execute-.+\.mts$/),
      code,
    );

    const [scriptPath] = mocks.sandbox.files.write.mock.calls[0];
    const [command, options] = mocks.sandbox.commands.run.mock.calls[0];
    expect(command).toContain('npx --yes tsx@4.22.4');
    expect(command).not.toContain(code);
    expect(command).not.toContain('rm -f');
    expect(options).toEqual({ timeoutMs: 120_000 });
    expect(mocks.sandbox.commands.run).toHaveBeenNthCalledWith(2, `rm -f ${scriptPath}`, {
      timeoutMs: 10_000,
    });
  });

  it('cleans up the TypeScript temp file when execution rejects', async () => {
    mocks.sandbox.commands.run
      .mockRejectedValueOnce(new Error('execution timed out'))
      .mockResolvedValueOnce(okCommand());

    const result = await (
      await load()
    ).callTool('executeCode', {
      code: 'await new Promise(() => {});',
      language: 'typescript',
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('execution timed out');
    const [scriptPath] = mocks.sandbox.files.write.mock.calls[0];
    expect(mocks.sandbox.commands.run).toHaveBeenNthCalledWith(2, `rm -f ${scriptPath}`, {
      timeoutMs: 10_000,
    });
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

  it('surfaces execution errors through the real cloud sandbox runtime', async () => {
    mocks.sandbox.runCode.mockResolvedValue({
      error: { value: 'ZeroDivisionError' },
      logs: { stderr: ['boom'], stdout: [] },
      results: [],
    });

    const provider = await load();
    const runtime = new CloudSandboxExecutionRuntime({
      callTool: provider.callTool.bind(provider),
      exportAndUploadFile: vi.fn(),
    });

    const output = await runtime.executeCode({ code: '1/0', language: 'python' });

    // CloudSandboxExecutionRuntime builds model-visible failure content from
    // the outer envelope while retaining the nested payload for card state.
    expect(output.content).toBe('ZeroDivisionError');
    expect(output.state).toMatchObject({
      error: 'ZeroDivisionError',
      stderr: 'boom',
      success: false,
    });
    expect(output.success).toBe(true);
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
    const [launch] = mocks.sandbox.commands.run.mock.calls.at(-1)!;
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

    // Directory setup and process-group publication use a bounded control
    // timeout independent of the command's own lifetime.
    expect(mocks.sandbox.commands.run).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("directory = Path('/tmp/lobe-background')"),
      { timeoutMs: 10_000 },
    );
    expect(mocks.sandbox.commands.run.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sandbox.files.write.mock.invocationCallOrder[0],
    );

    const [launch] = mocks.sandbox.commands.run.mock.calls.at(-1)!;
    expect(launch).not.toContain('hello world');
    // The detached process gets the timeout, not just the launcher, and
    // timeout's own pid/group is the one we record and later kill.
    expect(launch).toContain('timeout --kill-after=5s 5s');
    expect(launch).toContain('command_pgid=$!');
    expect(launch).toContain('while group_alive');
    expect(launch).toContain('.timedout');
    // Without detaching every fd the caller waits for the background process.
    expect(launch).toContain('< /dev/null > /dev/null 2>&1');
  });

  it('preserves millisecond precision in a background timeout', async () => {
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    await (
      await load()
    ).callTool('runCommand', {
      background: true,
      command: 'sleep 60',
      timeout: 1001,
    });

    const [launch] = mocks.sandbox.commands.run.mock.calls.at(-1)!;
    expect(launch).toContain('timeout --kill-after=5s 1.001s');
    expect(launch).not.toContain('timeout --kill-after=5s 2s');
  });

  it.runIf(process.platform === 'linux')(
    'kills the entire background process group when it times out',
    async () => {
      const childPidFile = `/tmp/lobe-background/test-child-${process.pid}-${Date.now()}.pid`;
      await rm('/tmp/lobe-background', { force: true, recursive: true });
      await mkdir('/tmp/lobe-background', { recursive: true });
      await Promise.all(
        Array.from({ length: 1024 }, (_, index) =>
          writeFile(`/tmp/lobe-background/retained-${index}.exit`, '0'),
        ),
      );

      // Execute the generated scripts against real Linux process and file APIs.
      mocks.sandbox.files.write.mockImplementation(async (path: string, content: string) => {
        await writeFile(path, content);
      });
      mocks.sandbox.commands.run.mockImplementation(async (command: string) => {
        const { stderr, stdout } = await execFileAsync('sh', ['-c', command], {
          encoding: 'utf8',
        });

        return { exitCode: 0, stderr, stdout };
      });

      const provider = await load();
      const result = await provider.callTool('runCommand', {
        background: true,
        // The foreground shell exits successfully while its child stays in
        // the process group. The monitor must still own that child until the
        // deadline rather than publishing the shell's zero status early.
        command: `sleep 60 & echo $! > ${childPidFile}`,
        timeout: 2000,
      });
      const [launch] = mocks.sandbox.commands.run.mock.calls.at(-1)!;
      expect(launch).toContain('timeout --kill-after=5s 2s');

      const { commandId } = result.result as Record<string, string>;
      const base = `/tmp/lobe-background/${commandId}`;

      try {
        await vi.waitFor(
          async () => {
            expect(Number((await readFile(childPidFile, 'utf8')).trim())).toBeGreaterThan(1);
          },
          { interval: 25, timeout: 2000 },
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        await expect(readFile(`${base}.exit`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

        await vi.waitFor(
          async () => {
            expect((await readFile(`${base}.exit`, 'utf8')).trim()).toBe('124');
          },
          { interval: 50, timeout: 5000 },
        );

        const completionMarkers = (await readdir('/tmp/lobe-background')).filter((name) =>
          name.endsWith('.exit'),
        );
        expect(completionMarkers).toHaveLength(1024);

        const childPid = Number((await readFile(childPidFile, 'utf8')).trim());
        await vi.waitFor(
          async () => {
            expect(await isLinuxProcessTerminated(childPid)).toBe(true);
          },
          { interval: 50, timeout: 2000 },
        );

        const completed = await provider.callTool('getCommandOutput', { commandId });
        expect(completed.result).toMatchObject({
          exitCode: 124,
          newOutput: '',
          running: false,
          success: false,
        });

        for (const suffix of ['sh', 'log', 'pid', 'pgid', 'off', 'timedout']) {
          await expect(readFile(`${base}.${suffix}`, 'utf8')).rejects.toMatchObject({
            code: 'ENOENT',
          });
        }
        expect((await readFile(`${base}.exit`, 'utf8')).trim()).toBe('124');

        // Keeping the exit marker makes completion polling idempotent without
        // retaining the command body, output log, or stale process ids.
        const repeated = await provider.callTool('getCommandOutput', { commandId });
        expect(repeated.result).toMatchObject({
          exitCode: 124,
          newOutput: '',
          running: false,
        });
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
          ['sh', 'log', 'pid', 'pgid', 'exit', 'off', 'timedout'].map((suffix) =>
            rm(`${base}.${suffix}`, { force: true }),
          ),
        );
        await rm(childPidFile, { force: true });
        await rm('/tmp/lobe-background', { force: true, recursive: true });
      }
    },
  );

  it.runIf(process.platform === 'linux')(
    'drains completed background output in bounded chunks before cleanup',
    async () => {
      await rm('/tmp/lobe-background', { force: true, recursive: true });
      await mkdir('/tmp/lobe-background', { recursive: true });

      mocks.sandbox.files.write.mockImplementation(async (path: string, content: string) => {
        await writeFile(path, content);
      });
      mocks.sandbox.commands.run.mockImplementation(async (command: string) => {
        const { stderr, stdout } = await execFileAsync('sh', ['-c', command], {
          encoding: 'utf8',
        });

        return { exitCode: 0, stderr, stdout };
      });

      const provider = await load();
      const result = await provider.callTool('runCommand', {
        background: true,
        command: `python3 -c "import sys; sys.stdout.write('€' * 100000)"`,
        timeout: 5000,
      });
      const { commandId } = result.result as Record<string, string>;
      const base = `/tmp/lobe-background/${commandId}`;

      try {
        await vi.waitFor(
          async () => {
            expect((await readFile(`${base}.exit`, 'utf8')).trim()).toBe('0');
          },
          { interval: 50, timeout: 5000 },
        );

        const first = await provider.callTool('getCommandOutput', { commandId });
        const firstOutput = (first.result as Record<string, unknown>).newOutput;
        expect(first.result).toMatchObject({
          exitCode: null,
          hasMore: true,
          running: true,
          success: true,
        });
        expect(firstOutput).toBe('€'.repeat(87_381));
        await expect(readFile(`${base}.log`, 'utf8')).resolves.toHaveLength(100_000);
        await expect(readFile(`${base}.off`, 'utf8')).resolves.toBe('262143');

        const second = await provider.callTool('getCommandOutput', { commandId });
        const secondOutput = (second.result as Record<string, unknown>).newOutput;
        expect(second.result).toMatchObject({
          exitCode: 0,
          hasMore: false,
          running: false,
          success: true,
        });
        expect(secondOutput).toBe('€'.repeat(12_619));

        for (const suffix of ['sh', 'log', 'pid', 'pgid', 'off', 'timedout']) {
          await expect(readFile(`${base}.${suffix}`, 'utf8')).rejects.toMatchObject({
            code: 'ENOENT',
          });
        }
        expect((await readFile(`${base}.exit`, 'utf8')).trim()).toBe('0');

        const repeated = await provider.callTool('getCommandOutput', { commandId });
        expect(repeated.result).toMatchObject({
          exitCode: 0,
          hasMore: false,
          newOutput: '',
          running: false,
        });
      } finally {
        await rm('/tmp/lobe-background', { force: true, recursive: true });
      }
    },
  );

  // The tool contract polls for new output while the process keeps running, so
  // this must never block on completion.
  it('reports background progress without waiting for the process to exit', async () => {
    mocks.sandbox.commands.run.mockResolvedValue(
      okCommand(JSON.stringify({ newOutput: 'tick\n', running: true, success: true })),
    );

    const result = await (
      await load()
    ).callTool('getCommandOutput', {
      commandId: TEST_COMMAND_ID,
    });

    expect(result.result).toMatchObject({ newOutput: 'tick\n', running: true });
    expect(mocks.sandbox.commands.connect).not.toHaveBeenCalled();
  });

  it.runIf(process.platform === 'linux')(
    'waits for the monitor exit marker after the process group disappears',
    async () => {
      const base = `/tmp/lobe-background/${TEST_COMMAND_ID}`;
      await rm('/tmp/lobe-background', { force: true, recursive: true });
      await mkdir('/tmp/lobe-background', { recursive: true });
      await writeFile(`${base}.log`, '');
      await writeFile(`${base}.pgid`, '999999999');

      mocks.sandbox.commands.run.mockImplementation(async (command: string) => {
        const { stderr, stdout } = await execFileAsync('sh', ['-c', command], {
          encoding: 'utf8',
        });

        return { exitCode: 0, stderr, stdout };
      });

      try {
        const pending = await (
          await load()
        ).callTool('getCommandOutput', {
          commandId: TEST_COMMAND_ID,
        });

        expect(pending.result).toMatchObject({
          exitCode: null,
          hasMore: false,
          newOutput: '',
          running: true,
          success: true,
        });
      } finally {
        await rm('/tmp/lobe-background', { force: true, recursive: true });
      }
    },
  );

  it('forwards the requested command timeout', async () => {
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    await (await load()).callTool('runCommand', { command: 'sleep 1', timeout: 5000 });

    expect(mocks.sandbox.commands.run).toHaveBeenCalledWith(
      'sleep 1',
      expect.objectContaining({ timeoutMs: 5000 }),
    );
  });

  it('rejects non-positive command timeouts before starting work', async () => {
    const result = await (
      await load()
    ).callTool('runCommand', {
      command: 'echo should-not-run',
      timeout: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('positive finite number');
    expect(mocks.sandbox.commands.run).not.toHaveBeenCalled();
  });

  it('kills a background command by its identifier', async () => {
    mocks.sandbox.commands.run.mockResolvedValue(okCommand(JSON.stringify({ success: true })));

    const result = await (
      await load()
    ).callTool('killCommand', {
      commandId: TEST_COMMAND_ID,
    });

    expect(result.success).toBe(true);
    expect(scriptArgs(mocks.sandbox.commands.run.mock.calls[0][0])).toEqual({
      commandId: TEST_COMMAND_ID,
    });
  });

  it('rejects command ids that could escape the background directory', async () => {
    const result = await (
      await load()
    ).callTool('killCommand', {
      commandId: '../../proc/1',
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('sandbox-issued UUID');
    expect(mocks.sandbox.commands.run).not.toHaveBeenCalled();
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

  it('reacquires the same control-plane conversation after a process-local cache reset', async () => {
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    await (await load()).callTool('runCommand', { command: 'echo first' });
    await (await load()).callTool('runCommand', { command: 'echo after-cold-start' });

    const acquireRequests = controlPlaneRequests.filter(({ action }) => action === 'acquire');
    expect(acquireRequests).toHaveLength(2);

    const firstId = String(acquireRequests[0].payload.ConversationId);
    expect(acquireRequests[1].payload.ConversationId).toBe(firstId);
    expect(firstId).toMatch(/^[\w.-]{6,36}$/);
    expect(firstId).not.toContain(options.userId);
    expect(firstId).not.toContain(options.topicId);
  });

  it('renews a persistent instance for the upcoming operation lifetime', async () => {
    expiresInSec = 90;
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    const provider = await load();
    await provider.callTool('runCommand', { command: 'echo short', timeout: 1000 });

    // Ninety seconds remaining is outside the old 60-second renewal window,
    // but cannot cover a 120-second command plus the lifecycle headroom.
    expiresInSec = 300;
    await provider.callTool('runCommand', { command: 'echo long', timeout: 120_000 });

    expect(calls.update).toBe(1);
    expect(calls.acquire).toBe(1);
    expect(controlPlaneRequests.find(({ action }) => action === 'update')?.payload.Timeout).toBe(
      300,
    );
  });

  it('requests enough instance lifetime for an explicit long command timeout', async () => {
    mocks.env.TENCENT_SANDBOX_MODE = 'on-demand';
    expiresInSec = 360;
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    const result = await (
      await load()
    ).callTool('runCommand', {
      command: 'echo long',
      timeout: 300_000,
    });

    expect(result.success).toBe(true);
    expect(controlPlaneRequests[0]).toMatchObject({
      action: 'acquire',
      payload: { Timeout: 360 },
    });
  });

  it('caps a bootstrap reservation without skipping file initialization', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T00:00:00Z'));
    mocks.env.TENCENT_SANDBOX_MODE = 'on-demand';
    expiresInSec = 3600;
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    try {
      const provider = await load();
      const params = {
        background: true,
        command: 'near-limit-work',
        timeout: 3_540_000,
      };
      const initialized = await provider.callTool(
        'runCommand',
        { command: 'initialize files', timeout: 120_000 },
        { reserveFor: { params, toolName: 'runCommand' } },
      );

      expect(initialized.success).toBe(true);
      expect(controlPlaneRequests[0]).toMatchObject({
        action: 'acquire',
        payload: { Timeout: 3600 },
      });
      expect(mocks.sandbox.commands.run).toHaveBeenCalledWith('initialize files', {
        timeoutMs: 120_000,
      });

      await vi.advanceTimersByTimeAsync(120_000);
      const rejected = await provider.callTool('runCommand', params);

      expect(rejected.success).toBe(false);
      expect(rejected.error?.message).toContain('remaining lifetime');
      expect(calls.acquire).toBe(1);
      expect(calls.update).toBe(0);
      expect(calls.release).toBe(0);
      expect(mocks.sandbox.commands.run).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-evaluates lifetime after sharing an in-flight acquisition', async () => {
    expiresInSec = 180;
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    const provider = await load();
    const shortOperation = provider.callTool('runCommand', {
      command: 'echo short',
      timeout: 1000,
    });

    // The longer caller arrives while the short caller owns the shared
    // acquisition. Its required lifetime must be checked after that promise
    // settles instead of blindly reusing the 180-second credential.
    expiresInSec = 300;
    const longOperation = provider.callTool('runCommand', {
      command: 'echo long',
      timeout: 240_000,
    });

    const results = await Promise.all([shortOperation, longOperation]);
    expect(results.every(({ success }) => success)).toBe(true);
    expect(calls.acquire).toBe(1);
    expect(calls.update).toBe(1);
    expect(controlPlaneRequests.find(({ action }) => action === 'update')?.payload.Timeout).toBe(
      300,
    );
  });

  it('rejects an operation timeout that cannot fit in the control-plane lifetime', async () => {
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    const result = await (
      await load()
    ).callTool('runCommand', {
      command: 'echo should-not-run',
      timeout: 3_540_001,
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('timeout must not exceed 3,540,000 milliseconds');
    expect(calls.acquire).toBe(0);
    expect(mocks.sandbox.commands.run).not.toHaveBeenCalled();
  });

  it('keeps a still-valid instance after a transient renewal failure', async () => {
    expiresInSec = 10;
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    const provider = await load();
    await provider.callTool('runCommand', { command: 'echo acquire', timeout: 1000 });

    vi.mocked(fetch).mockImplementationOnce(
      async (input: string | URL | Request, init?: RequestInit) => {
        const action = fetchUrl(input).split('/').pop() as keyof typeof calls;
        calls[action] += 1;
        controlPlaneRequests.push({
          action,
          payload: JSON.parse(String(init?.body || '{}')),
        });
        throw new Error('transient update failure');
      },
    );

    const result = await provider.callTool('runCommand', {
      command: 'echo still-valid',
      timeout: 1000,
    });

    expect(calls.update).toBe(1);
    expect(calls.acquire).toBe(1);
    expect(calls.release).toBe(0);
    expect(result.success).toBe(true);
    expect(result.sessionExpiredAndRecreated).toBe(false);
    expect(mocks.sandbox.commands.run).toHaveBeenCalledTimes(2);
  });

  it('does not start an operation when renewal fails with too little lifetime remaining', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T00:00:00Z'));
    expiresInSec = 6;
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    try {
      const provider = await load();
      await provider.callTool('runCommand', { command: 'echo acquire', timeout: 100 });
      vi.advanceTimersByTime(5500);

      vi.mocked(fetch).mockImplementationOnce(
        async (input: string | URL | Request, init?: RequestInit) => {
          const action = fetchUrl(input).split('/').pop() as keyof typeof calls;
          calls[action] += 1;
          controlPlaneRequests.push({
            action,
            payload: JSON.parse(String(init?.body || '{}')),
          });
          throw new Error('transient update failure');
        },
      );

      const result = await provider.callTool('runCommand', {
        command: 'echo should-not-run',
        timeout: 800,
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('remaining instance lifetime is shorter');
      expect(calls.update).toBe(1);
      expect(calls.acquire).toBe(1);
      expect(mocks.sandbox.commands.run).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors the backend-confirmed expiry when a renewal is capped', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T00:00:00Z'));
    expiresInSec = 10;
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    try {
      const provider = await load();
      await provider.callTool('runCommand', { command: 'echo acquire', timeout: 100 });
      await provider.callTool('runCommand', { command: 'echo renew', timeout: 100 });

      expect(calls.update).toBe(1);

      vi.advanceTimersByTime(11_000);
      const result = await provider.callTool('runCommand', {
        command: 'echo reacquire',
        timeout: 100,
      });

      expect(calls.acquire).toBe(2);
      expect(result.sessionExpiredAndRecreated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reacquires without release when renewal has an ambiguous outcome', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T00:00:00Z'));
    expiresInSec = 6;
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    try {
      const provider = await load();
      await provider.callTool('runCommand', { command: 'echo acquire', timeout: 100 });
      vi.advanceTimersByTime(5900);

      vi.mocked(fetch).mockImplementation(
        async (input: string | URL | Request, init?: RequestInit) => {
          const action = fetchUrl(input).split('/').pop() as keyof typeof calls;
          calls[action] += 1;
          controlPlaneRequests.push({
            action,
            payload: JSON.parse(String(init?.body || '{}')),
          });

          if (action === 'update') {
            // The service renewed the conversation, but the response was lost
            // after the old local timestamp passed.
            vi.setSystemTime(new Date(Date.now() + 200));
            throw new Error('response timed out after the update committed');
          }

          return controlPlaneResponse(
            action === 'acquire'
              ? {
                  InstanceExpiresAt: new Date(Date.now() + 300_000).toISOString(),
                  InstanceId: 'instance-1',
                  SandboxDomain: 'ap-beijing.tencentags.com',
                  Token: 'sit_test',
                }
              : {},
          );
        },
      );

      const result = await provider.callTool('runCommand', {
        command: 'echo reacquire',
        timeout: 100,
      });

      expect(calls.update).toBe(1);
      expect(calls.acquire).toBe(2);
      expect(calls.release).toBe(0);
      expect(result.sessionExpiredAndRecreated).toBe(false);

      const acquireRequests = controlPlaneRequests.filter(({ action }) => action === 'acquire');
      expect(acquireRequests[1].payload.ConversationId).toBe(
        acquireRequests[0].payload.ConversationId,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves expiry state independently for two sessions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T00:00:00Z'));
    expiresInSec = 10;
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    try {
      const providerA = await load();
      const { TencentSandboxProvider } = await import('./tencent');
      const providerB = new TencentSandboxProvider({ ...options, topicId: 'topic-2' });

      await providerA.callTool('runCommand', { command: 'echo A', timeout: 100 });
      await providerB.callTool('runCommand', { command: 'echo B', timeout: 100 });
      vi.advanceTimersByTime(11_000);

      const recreatedA = await providerA.callTool('runCommand', {
        command: 'echo A2',
        timeout: 100,
      });
      const recreatedB = await providerB.callTool('runCommand', {
        command: 'echo B2',
        timeout: 100,
      });

      expect(recreatedA.sessionExpiredAndRecreated).toBe(true);
      expect(recreatedB.sessionExpiredAndRecreated).toBe(true);
      expect(calls.acquire).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recognizes a cross-replica renewal after the local expiry passes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T00:00:00Z'));
    expiresInSec = 6;
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    try {
      const provider = await load();
      await provider.callTool('runCommand', { command: 'echo acquire', timeout: 100 });
      vi.advanceTimersByTime(6100);

      vi.mocked(fetch).mockImplementation(
        async (input: string | URL | Request, init?: RequestInit) => {
          const action = fetchUrl(input).split('/').pop() as keyof typeof calls;
          calls[action] += 1;
          controlPlaneRequests.push({
            action,
            payload: JSON.parse(String(init?.body || '{}')),
          });

          return controlPlaneResponse({
            InstanceExpiresAt: new Date(Date.now() + 300_000).toISOString(),
            // Another replica renewed the deterministic conversation, so
            // reacquire returns its original sandbox rather than a reset.
            InstanceId: 'instance-1',
            SandboxDomain: 'ap-beijing.tencentags.com',
            Token: 'sit_test',
          });
        },
      );

      const result = await provider.callTool('runCommand', {
        command: 'echo reacquire',
        timeout: 100,
      });

      expect(calls.update).toBe(0);
      expect(calls.acquire).toBe(2);
      expect(calls.release).toBe(0);
      expect(result.sessionExpiredAndRecreated).toBe(false);

      const acquireRequests = controlPlaneRequests.filter(({ action }) => action === 'acquire');
      expect(acquireRequests[1].payload.ConversationId).toBe(
        acquireRequests[0].payload.ConversationId,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // Dropping a still-valid instance early would strand uploaded files and
  // background processes mid-session.
  it('keeps an on-demand instance until it actually expires', async () => {
    mocks.env.TENCENT_SANDBOX_MODE = 'on-demand';
    expiresInSec = 10;
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    const provider = await load();
    await provider.callTool('runCommand', { command: 'echo 1', timeout: 1000 });
    await provider.callTool('runCommand', { command: 'echo 2', timeout: 1000 });

    expect(calls.update).toBe(0);
    expect(calls.release).toBe(0);
    expect(calls.acquire).toBe(1);
  });

  it('rejects an on-demand operation that cannot finish before expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T00:00:00Z'));
    mocks.env.TENCENT_SANDBOX_MODE = 'on-demand';
    expiresInSec = 10;
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    try {
      const provider = await load();
      const first = await provider.callTool('runCommand', {
        command: 'echo fits',
        timeout: 1000,
      });
      await vi.advanceTimersByTimeAsync(6000);
      const rejected = await provider.callTool('runCommand', {
        command: 'echo too-late',
        timeout: 5000,
      });

      expect(first.success).toBe(true);
      expect(rejected.success).toBe(false);
      expect(rejected.error?.message).toContain('remaining lifetime');
      expect(calls.acquire).toBe(1);
      expect(calls.update).toBe(0);
      expect(calls.release).toBe(0);
      expect(mocks.sandbox.commands.run).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps late on-demand background status and cancellation available', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T00:00:00Z'));
    mocks.env.TENCENT_SANDBOX_MODE = 'on-demand';
    expiresInSec = 360;
    mocks.sandbox.files.write.mockResolvedValue(undefined);
    mocks.sandbox.commands.run
      .mockResolvedValueOnce(okCommand())
      .mockResolvedValueOnce(okCommand())
      .mockResolvedValueOnce(
        okCommand(
          JSON.stringify({
            exitCode: 0,
            hasMore: false,
            newOutput: 'done\n',
            running: false,
            success: true,
          }),
        ),
      )
      .mockResolvedValueOnce(okCommand(JSON.stringify({ forced: false, success: true })));

    try {
      const provider = await load();
      const started = await provider.callTool('runCommand', {
        background: true,
        command: 'long-background-work',
        timeout: 300_000,
      });
      expect(started.success).toBe(true);
      await vi.advanceTimersByTimeAsync(300_000);
      const { commandId } = started.result as Record<string, string>;

      // Sixty seconds remain: enough for bounded status/cancel helpers, but
      // not for the unrelated 120-second default command workload.
      const output = await provider.callTool('getCommandOutput', {
        commandId,
      });
      const killed = await provider.callTool('killCommand', {
        commandId,
      });

      expect(output.result).toMatchObject({ exitCode: 0, newOutput: 'done\n' });
      expect(killed.result).toMatchObject({ forced: false, success: true });
      expect(calls.acquire).toBe(1);
      expect(calls.update).toBe(0);
      expect(calls.release).toBe(0);
      expect(controlPlaneRequests[0]).toMatchObject({
        action: 'acquire',
        payload: { Timeout: 360 },
      });
      expect(mocks.sandbox.commands.run.mock.calls[2][1]).toEqual({ timeoutMs: 10_000 });
      expect(mocks.sandbox.commands.run.mock.calls[3][1]).toEqual({ timeoutMs: 10_000 });
    } finally {
      vi.useRealTimers();
    }
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

  it('bounds cached credentials across many one-shot sessions', async () => {
    expiresInSec = 3600;
    mocks.sandbox.commands.run.mockResolvedValue(okCommand());

    const firstProvider = await load();
    const { TencentSandboxProvider } = await import('./tencent');
    const providers = [firstProvider];

    // One more than the live-cache limit proves old credentials are evicted.
    // The separate, bounded id-only history still detects a changed instance.
    for (let index = 1; index <= 1024; index += 1) {
      providers.push(
        new TencentSandboxProvider({
          ...options,
          topicId: `one-shot-topic-${index}`,
        }),
      );
    }

    for (const provider of providers) {
      await provider.callTool('runCommand', { command: 'true' });
    }

    expect(calls.acquire).toBe(1025);
    await providers.at(-1)!.callTool('runCommand', { command: 'still-cached' });
    expect(calls.acquire).toBe(1025);
    const reacquired = await providers[0].callTool('runCommand', { command: 'evicted' });

    expect(calls.acquire).toBe(1026);
    expect(reacquired.sessionExpiredAndRecreated).toBe(true);
  });

  it.runIf(process.platform === 'linux')(
    'escalates manual cancellation for a TERM-resistant process group',
    async () => {
      const childPidFile = `/tmp/lobe-background/test-kill-${process.pid}-${Date.now()}.pid`;
      await rm('/tmp/lobe-background', { force: true, recursive: true });

      mocks.sandbox.files.write.mockImplementation(async (path: string, content: string) => {
        await writeFile(path, content);
      });
      mocks.sandbox.commands.run.mockImplementation(async (command: string) => {
        const { stderr, stdout } = await execFileAsync('sh', ['-c', command], {
          encoding: 'utf8',
        });

        return { exitCode: 0, stderr, stdout };
      });

      const provider = await load();
      const started = await provider.callTool('runCommand', {
        background: true,
        command: `trap '' TERM; echo $$ > ${childPidFile}; while :; do sleep 1; done`,
        timeout: 30_000,
      });
      const { commandId } = started.result as Record<string, string>;
      const base = `/tmp/lobe-background/${commandId}`;

      try {
        await vi.waitFor(
          async () => {
            expect(Number((await readFile(childPidFile, 'utf8')).trim())).toBeGreaterThan(1);
            expect(Number((await readFile(`${base}.pgid`, 'utf8')).trim())).toBeGreaterThan(1);
          },
          { interval: 25, timeout: 2000 },
        );

        const childPid = Number((await readFile(childPidFile, 'utf8')).trim());
        const killed = await provider.callTool('killCommand', { commandId });

        expect(killed.success).toBe(true);
        expect(killed.result).toMatchObject({ forced: true, success: true });
        await vi.waitFor(
          async () => {
            expect(await isLinuxProcessTerminated(childPid)).toBe(true);
          },
          { interval: 50, timeout: 3000 },
        );
      } finally {
        try {
          const pgid = Number((await readFile(`${base}.pgid`, 'utf8')).trim());
          process.kill(-pgid, 'SIGKILL');
        } catch {
          // The expected path: killCommand removed the complete group.
        }

        try {
          const childPid = Number((await readFile(childPidFile, 'utf8')).trim());
          process.kill(childPid, 'SIGKILL');
        } catch {
          // The expected path: the TERM-resistant process is already gone.
        }

        await Promise.all(
          ['sh', 'log', 'pid', 'pgid', 'exit', 'off', 'timedout'].map((suffix) =>
            rm(`${base}.${suffix}`, { force: true }),
          ),
        );
        await rm(childPidFile, { force: true });
        await rm('/tmp/lobe-background', { force: true, recursive: true });
      }
    },
  );

  it.runIf(process.platform === 'linux')(
    'does not signal a reused process group after a background command exits',
    async () => {
      await rm('/tmp/lobe-background', { force: true, recursive: true });

      mocks.sandbox.files.write.mockImplementation(async (path: string, content: string) => {
        await writeFile(path, content);
      });
      mocks.sandbox.commands.run.mockImplementation(async (command: string) => {
        const { stderr, stdout } = await execFileAsync('sh', ['-c', command], {
          encoding: 'utf8',
        });

        return { exitCode: 0, stderr, stdout };
      });

      const provider = await load();
      const started = await provider.callTool('runCommand', {
        background: true,
        command: 'true',
        timeout: 5000,
      });
      const { commandId } = started.result as Record<string, string>;
      const base = `/tmp/lobe-background/${commandId}`;
      let unrelatedPid: number | undefined;

      try {
        await vi.waitFor(
          async () => {
            expect((await readFile(`${base}.exit`, 'utf8')).trim()).toBe('0');
          },
          { interval: 25, timeout: 2000 },
        );
        const monitorSessionId = Number((await readFile(`${base}.pid`, 'utf8')).trim());
        await vi.waitFor(
          async () => {
            expect(await isLinuxSessionTerminated(monitorSessionId)).toBe(true);
          },
          { interval: 25, timeout: 2000 },
        );

        const { stdout } = await execFileAsync(
          'sh',
          ['-c', 'setsid sleep 60 < /dev/null > /dev/null 2>&1 & echo $!'],
          { encoding: 'utf8' },
        );
        unrelatedPid = Number(stdout.trim());
        await writeFile(`${base}.pgid`, String(unrelatedPid));

        const killed = await provider.callTool('killCommand', { commandId });

        expect(killed.result).toMatchObject({ forced: false, success: true });
        expect(await isLinuxProcessTerminated(unrelatedPid)).toBe(false);
      } finally {
        if (unrelatedPid !== undefined) {
          try {
            process.kill(-unrelatedPid, 'SIGKILL');
          } catch {
            try {
              process.kill(unrelatedPid, 'SIGKILL');
            } catch {
              // Cleanup is best-effort if the process already exited.
            }
          }
        }

        await rm('/tmp/lobe-background', { force: true, recursive: true });
      }
    },
  );

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
    expiresInSec = 360;
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
    expect(controlPlaneRequests[0]).toMatchObject({
      action: 'acquire',
      payload: { Timeout: 360 },
    });
    const [command, commandOptions] = mocks.sandbox.commands.run.mock.calls[0];
    expect(command).toContain('urlopen(request, timeout=300)');
    expect(commandOptions).toEqual({ timeoutMs: 300_000 });
  });

  it('keeps exports alive beyond the default 120-second command timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    expiresInSec = 360;
    mocks.sandbox.commands.run.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120_001));

      return okCommand(JSON.stringify({ size: 4096, status: 200, success: true }));
    });

    try {
      const provider = await load();
      const exportPromise = provider.exportFileToUploadUrl({
        filename: 'large-chart.png',
        path: '/mnt/data/large-chart.png',
        uploadUrl: 'https://example.com/upload',
      });

      await vi.advanceTimersByTimeAsync(120_001);

      await expect(exportPromise).resolves.toMatchObject({ size: 4096, success: true });
      expect(mocks.sandbox.commands.run).toHaveBeenCalledWith(expect.any(String), {
        timeoutMs: 300_000,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
