import type * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SpawnAgentHandle } from './spawnAgent';

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

const configOverrides = (args: string[]) =>
  args.flatMap((arg, index) => (args[index - 1] === '-c' ? [arg] : []));

const setOverride = (args: string[], key: string) => {
  const prefix = `shell_environment_policy.set.${key}=`;
  const raw = configOverrides(args).find((arg) => arg.startsWith(prefix));
  return raw === undefined ? undefined : (JSON.parse(raw.slice(prefix.length)) as string);
};

const SCM_ENV = {
  LOBEHUB_JWT: 'header.payload.signature',
  LOBEHUB_OPERATION_ID: 'op_1',
  LOBEHUB_SCM_CREDENTIAL: '1',
  LOBEHUB_SERVER: 'https://app.lobehub.com',
};

const drain = async (handle: SpawnAgentHandle) => {
  for await (const _ of handle.events) {
    // drain
  }
  await handle.exit;
};

describe('spawnAgent requester credential JWT file', () => {
  let codexHome: string;

  beforeEach(async () => {
    spawnCalls.length = 0;
    codexHome = await mkdtemp(path.join(os.tmpdir(), 'lobe-scm-jwt-'));
  });

  afterEach(async () => {
    nextFakeProc = null;
    await rm(codexHome, { force: true, recursive: true });
  });

  it('gives a Claude Code run a renewing JWT file for the git credential helper', async () => {
    const held = createHeldProc();
    nextFakeProc = held.proc;
    const { spawnAgent } = await import('./spawnAgent');
    const { refreshCodexJwtFiles } = await import('./codexShellEnv');

    const handle = await spawnAgent({
      agentType: 'claude-code',
      env: SCM_ENV,
      operationId: 'op_1',
      prompt: 'hello',
    });
    const jwtPath = spawnCalls[0].options.env.LOBEHUB_SCM_JWT_FILE as string;

    expect(await readFile(jwtPath, 'utf8')).toBe(SCM_ENV.LOBEHUB_JWT);
    expect((await stat(jwtPath)).mode & 0o777).toBe(0o600);
    await refreshCodexJwtFiles('renewed.jwt.token');
    expect(await readFile(jwtPath, 'utf8')).toBe('renewed.jwt.token');

    held.finish();
    await drain(handle);
    await vi.waitFor(async () => {
      await expect(stat(path.dirname(jwtPath))).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('forwards the file into Codex shells', async () => {
    const held = createHeldProc();
    nextFakeProc = held.proc;
    const { spawnAgent } = await import('./spawnAgent');

    const handle = await spawnAgent({
      agentType: 'codex',
      env: { ...SCM_ENV, CODEX_HOME: codexHome },
      operationId: 'op_1',
      prompt: 'hello',
    });
    const { args } = spawnCalls[0];

    const forwarded = setOverride(args, 'LOBEHUB_SCM_JWT_FILE');
    expect(forwarded).toBe(setOverride(args, 'LOBEHUB_JWT_FILE'));
    expect(await readFile(forwarded!, 'utf8')).toBe(SCM_ENV.LOBEHUB_JWT);

    held.finish();
    await drain(handle);
  });

  it('adds no file to a run without a requester credential', async () => {
    const held = createHeldProc();
    nextFakeProc = held.proc;
    const { spawnAgent } = await import('./spawnAgent');
    const { LOBEHUB_SCM_CREDENTIAL: _marker, ...plain } = SCM_ENV;

    const handle = await spawnAgent({
      agentType: 'claude-code',
      env: plain,
      operationId: 'op_1',
      prompt: 'hello',
    });

    expect(spawnCalls[0].options.env).not.toHaveProperty('LOBEHUB_SCM_JWT_FILE');
    held.finish();
    await drain(handle);
  });
});
