import type * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnCalls: Array<{ args: string[]; command: string; options: any }> = [];
let nextFakeProc: any = null;

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('node:child_process');
  return {
    ...actual,
    execFile: vi.fn(),
    spawn: vi.fn((command: string, args: string[], options: any) => {
      spawnCalls.push({ args, command, options });
      return nextFakeProc;
    }),
  };
});

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof os>('node:os');
  return { ...actual, platform: vi.fn(() => 'linux') };
});

/** A child that stays alive until `finish()` so the JWT file can be inspected mid-run. */
const createHeldProc = () => {
  const proc = new EventEmitter() as any;
  const stdout = new PassThrough();
  proc.stdout = stdout;
  proc.stderr = new PassThrough();
  proc.stdin = {
    end: vi.fn(),
    once: vi.fn(),
    write: vi.fn((_: string, cb?: () => void) => cb?.()),
  };
  proc.kill = vi.fn();
  proc.killed = false;
  proc.pid = 4242;
  const finish = () => {
    stdout.end();
    proc.stderr.end();
    proc.emit('exit', 0, null);
  };
  return { finish, proc };
};

const RUN_ENV = {
  LOBEHUB_AGENT_ID: 'agt_1',
  LOBEHUB_ASSISTANT_MESSAGE_ID: 'msg_1',
  LOBEHUB_JWT: 'header.payload.signature',
  LOBEHUB_OPERATION_ID: 'op_1',
  LOBEHUB_SERVER: 'https://app.lobehub.com',
  LOBEHUB_TOPIC_ID: 'tpc_1',
  LOBEHUB_WORKSPACE_ID: 'ws_1',
};

const configOverrides = (args: string[]) =>
  args.flatMap((arg, index) => (args[index - 1] === '-c' ? [arg] : []));

const setOverride = (args: string[], key: string) => {
  const prefix = `shell_environment_policy.set.${key}=`;
  const raw = configOverrides(args).find((arg) => arg.startsWith(prefix));
  return raw === undefined ? undefined : (JSON.parse(raw.slice(prefix.length)) as string);
};

describe('spawnAgent codex shell environment', () => {
  let codexHome: string;

  beforeEach(async () => {
    spawnCalls.length = 0;
    codexHome = await mkdtemp(path.join(os.tmpdir(), 'lobe-codex-shell-env-'));
  });

  afterEach(async () => {
    nextFakeProc = null;
    await rm(codexHome, { force: true, recursive: true });
  });

  it('forwards the run context through shell_environment_policy.set and keeps the JWT out of argv', async () => {
    const held = createHeldProc();
    nextFakeProc = held.proc;
    const { spawnAgent } = await import('./spawnAgent');

    const handle = await spawnAgent({
      agentType: 'codex',
      env: { ...RUN_ENV, CODEX_HOME: codexHome },
      extraArgs: ['-c', 'model_reasoning_effort="high"'],
      operationId: 'op_1',
      prompt: 'hello',
    });
    const { args, options } = spawnCalls[0];

    for (const key of [
      'LOBEHUB_AGENT_ID',
      'LOBEHUB_ASSISTANT_MESSAGE_ID',
      'LOBEHUB_OPERATION_ID',
      'LOBEHUB_SERVER',
      'LOBEHUB_TOPIC_ID',
      'LOBEHUB_WORKSPACE_ID',
    ] as const) {
      expect(setOverride(args, key)).toBe(RUN_ENV[key]);
    }
    expect(setOverride(args, 'LOBEHUB_JWT')).toBeUndefined();
    expect(args.join('\n')).not.toContain(RUN_ENV.LOBEHUB_JWT);
    // The user's own overrides stay last so they can still win.
    expect(args.at(-1)).toBe('model_reasoning_effort="high"');
    // The process env itself is unchanged; only the shell policy is extended.
    expect(options.env.LOBEHUB_JWT).toBe(RUN_ENV.LOBEHUB_JWT);

    const jwtPath = setOverride(args, 'LOBEHUB_JWT_FILE')!;
    expect(await readFile(jwtPath, 'utf8')).toBe(RUN_ENV.LOBEHUB_JWT);
    expect((await stat(jwtPath)).mode & 0o777).toBe(0o600);

    held.finish();
    for await (const _ of handle.events) {
      // drain
    }
    await handle.exit;
    await vi.waitFor(async () => {
      await expect(stat(path.dirname(jwtPath))).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('keeps the overrides before the resume thread id positional', async () => {
    const held = createHeldProc();
    nextFakeProc = held.proc;
    const { spawnAgent } = await import('./spawnAgent');

    const handle = await spawnAgent({
      agentType: 'codex',
      env: { ...RUN_ENV, CODEX_HOME: codexHome },
      operationId: 'op_1',
      prompt: 'hello',
      resumeSessionId: 'thread-1',
    });
    const { args } = spawnCalls[0];

    expect(args.slice(0, 2)).toEqual(['exec', 'resume']);
    expect(args.slice(-2)).toEqual(['thread-1', '-']);
    expect(setOverride(args, 'LOBEHUB_OPERATION_ID')).toBe('op_1');

    held.finish();
    for await (const _ of handle.events) {
      // drain
    }
    await handle.exit;
  });

  it('removes the JWT file when the spawn fails', async () => {
    nextFakeProc = null;
    const { spawnAgent } = await import('./spawnAgent');
    const listJwtDirs = async () =>
      (await readdir(os.tmpdir())).filter((name) => name.startsWith('lobehub-codex-'));
    const before = new Set(await listJwtDirs());

    await expect(
      spawnAgent({
        agentType: 'codex',
        env: { ...RUN_ENV, CODEX_HOME: codexHome },
        operationId: 'op_1',
        prompt: 'hello',
      }),
    ).rejects.toThrow();

    expect((await listJwtDirs()).filter((name) => !before.has(name))).toEqual([]);
  });

  it('leaves other agent types untouched', async () => {
    const held = createHeldProc();
    nextFakeProc = held.proc;
    const { spawnAgent } = await import('./spawnAgent');

    const handle = await spawnAgent({
      agentType: 'claude-code',
      env: RUN_ENV,
      operationId: 'op_1',
      prompt: 'hello',
    });
    expect(spawnCalls[0].args.join('\n')).not.toContain('shell_environment_policy');

    held.finish();
    for await (const _ of handle.events) {
      // drain
    }
    await handle.exit;
  });
});
