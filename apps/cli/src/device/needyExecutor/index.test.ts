import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectNeedyCapability, NeedyExecutorSupervisor } from './index';

const CREDENTIAL = 'needy-runner.secret-value';

const attachParams = (overrides: Record<string, unknown> = {}) => ({
  address: { host: 'needy-daemon.example.com', port: 7400 },
  attachmentId: 'session-1',
  credential: CREDENTIAL,
  runnerName: 'ext-0123456789ab-mac',
  ttlSeconds: 3600,
  version: '0.0.22',
  ...overrides,
});

/** A stand-in for the needy runner: exits when killed, or when the test says so. */
class FakeRunner extends EventEmitter {
  readonly signals: string[] = [];
  readonly stderr = new PassThrough();
  readonly stdout = new PassThrough();

  constructor(
    readonly binary: string,
    readonly argv: string[],
    readonly options: { cwd?: string; env?: NodeJS.ProcessEnv },
  ) {
    super();
  }

  exit(code: number) {
    this.emit('exit', code, null);
  }

  kill(signal: string) {
    this.signals.push(signal);
    this.emit('exit', null, signal);
    return true;
  }
}

describe('NeedyExecutorSupervisor', () => {
  let stateDir: string;
  let runners: FakeRunner[];
  let supervisor: NeedyExecutorSupervisor;
  const release = { binary: vi.fn(async (version: string) => `/cache/${version}/needy`) };

  /**
   * Wait until the supervisor spawned `count` runners. It does real file I/O
   * first, which fake timers do not cover, so poll on `setImmediate`.
   */
  const until = async (condition: () => boolean, what: string) => {
    for (let turn = 0; !condition(); turn++) {
      if (turn > 10_000) throw new Error(`${what} never happened`);
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  const spawned = (count: number) => until(() => runners.length >= count, `runner ${count}`);

  /** Attach and let the early-exit window pass. */
  const attach = async (params: unknown = attachParams()) => {
    const before = runners.length;
    const pending = supervisor.attach(params);
    const outcome = pending.then(
      () => 'done',
      () => 'done',
    );
    // A reused attachment spawns nothing; stop waiting once the call settles.
    await Promise.race([spawned(before + 1), outcome]);
    await vi.advanceTimersByTimeAsync(2000);
    return pending;
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'needy-executor-'));
    runners = [];
    release.binary.mockClear();
    supervisor = new NeedyExecutorSupervisor({
      logger: { debug: () => {}, info: () => {} },
      now: () => Date.parse('2026-11-27T00:00:00Z'),
      release,
      spawn: ((binary: string, argv: string[], options: FakeRunner['options']) => {
        const runner = new FakeRunner(binary, argv, options);
        runners.push(runner);
        return runner as unknown as ChildProcess;
      }) as never,
      stateDir,
    });
  });

  afterEach(async () => {
    supervisor.dispose();
    vi.useRealTimers();
    await fs.rm(stateDir, { force: true, recursive: true });
  });

  it('should run the pinned needy as an ephemeral executor runner built from the params', async () => {
    const result = await attach();

    expect(release.binary).toHaveBeenCalledWith('0.0.22');
    expect(runners).toHaveLength(1);
    const [runner] = runners;
    const credentialFile = path.join(stateDir, 'session-1', 'credential');
    expect(runner.binary).toBe('/cache/0.0.22/needy');
    expect(runner.argv).toEqual([
      'runner',
      'serve',
      '--address',
      'tcp://needy-daemon.example.com:7400',
      '--name',
      'ext-0123456789ab-mac',
      '--credential-file',
      credentialFile,
      '--roles',
      'executor',
      '--ephemeral',
    ]);
    expect(result).toEqual({
      attachmentId: 'session-1',
      expiresAt: '2026-11-27T01:00:00.000Z',
      reused: false,
      runnerName: 'ext-0123456789ab-mac',
      version: '0.0.22',
    });
  });

  it('should hand the credential over a private file, never argv or the environment', async () => {
    await attach();

    const [runner] = runners;
    const credentialFile = path.join(stateDir, 'session-1', 'credential');
    expect(await fs.readFile(credentialFile, 'utf8')).toBe(CREDENTIAL);
    expect((await fs.stat(credentialFile)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(credentialFile))).mode & 0o777).toBe(0o700);
    expect(runner.argv.join(' ')).not.toContain(CREDENTIAL);
    expect(JSON.stringify(runner.options.env ?? {})).not.toContain(CREDENTIAL);
  });

  it('should bracket an IPv6 daemon address', async () => {
    await attach(attachParams({ address: { host: '2001:db8::1', port: 7400 } }));

    expect(runners[0].argv[3]).toBe('tcp://[2001:db8::1]:7400');
  });

  it('should reuse the runner when the same attachment is attached again', async () => {
    await attach();
    const again = await attach();

    expect(again.reused).toBe(true);
    expect(runners).toHaveLength(1);
  });

  it('should replace the runner when an attachment comes back with new params', async () => {
    await attach();
    const replaced = await attach(attachParams({ credential: 'needy-runner.rotated' }));

    expect(replaced.reused).toBe(false);
    expect(runners).toHaveLength(2);
    expect(runners[0].signals).toEqual(['SIGTERM']);
    const credentialFile = path.join(stateDir, 'session-1', 'credential');
    expect(await fs.readFile(credentialFile, 'utf8')).toBe('needy-runner.rotated');
  });

  it('should refuse params a server could use to inject a command, naming fields not values', async () => {
    const bad = attachParams({
      address: { host: 'example.com; rm -rf ~', port: 7400 },
      attachmentId: '../escape',
      credential: `${CREDENTIAL} --roles actor`,
      runnerName: 'Not A Label',
      version: '0.0.22 && curl example.com',
    });

    const error = await supervisor.attach(bad).catch((error_: Error) => error_);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'invalid attachNeedyExecutor params: address.host, attachmentId, credential, runnerName, version',
    );
    expect((error as Error).message).not.toContain(CREDENTIAL);
    expect(runners).toHaveLength(0);
    expect(release.binary).not.toHaveBeenCalled();
  });

  it('should report a runner that exits right away and clean up its credential', async () => {
    const pending = supervisor.attach(attachParams());
    await spawned(1);
    runners[0].stderr.write('Error: runner credential refused\n');
    await vi.advanceTimersByTimeAsync(0);
    runners[0].exit(1);

    await expect(pending).rejects.toThrow(
      'needy runner exited with code 1: Error: runner credential refused',
    );
    expect(supervisor.size).toBe(0);
    await expect(fs.access(path.join(stateDir, 'session-1'))).rejects.toThrow();
  });

  it('should stop the runner and delete its directory on detach; detaching twice is fine', async () => {
    await attach();

    await expect(supervisor.detach({ attachmentId: 'session-1' })).resolves.toEqual({
      detached: true,
    });
    expect(runners[0].signals).toEqual(['SIGTERM']);
    await expect(fs.access(path.join(stateDir, 'session-1'))).rejects.toThrow();
    await expect(supervisor.detach({ attachmentId: 'session-1' })).resolves.toEqual({
      detached: false,
    });
  });

  it('should stop the runner when its TTL passes without a detach', async () => {
    await attach(attachParams({ ttlSeconds: 60 }));

    await vi.advanceTimersByTimeAsync(60_000);
    // Stopping waits for the runner's log to close, which is real file I/O.
    await until(() => supervisor.size === 0, 'the expired runner stopping');

    expect(runners[0].signals).toEqual(['SIGTERM']);
  });

  it('should forget a runner that ends on its own after its run', async () => {
    await attach();

    runners[0].exit(0);
    await until(() => supervisor.size === 0, 'the finished runner being forgotten');

    await expect(fs.access(path.join(stateDir, 'session-1'))).rejects.toThrow();
  });

  it('should host at most four runners', async () => {
    for (const id of ['a', 'b', 'c', 'd']) await attach(attachParams({ attachmentId: id }));

    await expect(supervisor.attach(attachParams({ attachmentId: 'e' }))).rejects.toThrow(
      'already hosts 4 needy executors',
    );
  });

  it('should stop every runner and delete every credential on dispose', async () => {
    await attach(attachParams({ attachmentId: 'a' }));
    await attach(attachParams({ attachmentId: 'b' }));

    supervisor.dispose();

    expect(runners.map((runner) => runner.signals)).toEqual([['SIGTERM'], ['SIGTERM']]);
    expect(await fs.readdir(stateDir)).toEqual([]);
    await expect(supervisor.attach(attachParams())).rejects.toThrow('shutting down');
  });
});

describe('collectNeedyCapability', () => {
  it('should report an actor when the needy guest directory exists', () => {
    expect(collectNeedyCapability((dir) => dir === '/.needy').actor).toBe(true);
    expect(collectNeedyCapability(() => false).actor).toBe(false);
  });
});
