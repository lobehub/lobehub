import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENT_CREDENTIAL_RUN_DIR_ENV, trackAgentCredentialRun } from './runLease';
import { resolveAgentCredentialSpawnEnv } from './spawnEnv';
import {
  CODEX_CREDENTIAL_REPLACED_REASON,
  installAgentCredential,
  removeAgentCredential,
} from './store';

const jwt = (payload: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

/** A ChatGPT login as Codex writes it, `refresh` standing for a renewal. */
const chatgptAuth = (user: string, refresh = 'r1', accountId = 'acct-team') =>
  JSON.stringify({
    tokens: {
      access_token: `access-${user}-${refresh}`,
      account_id: accountId,
      id_token: jwt({ sub: user }),
      refresh_token: `refresh-${user}-${refresh}`,
    },
  });

const codexParams = (authJson: string) => ({
  provider: 'codex',
  secret: { authJson, type: 'codex-auth-json' },
});

let tempDir: string;
let rootDir: string;
const runStop = { forceMs: 500, graceMs: 2000, pollMs: 10 };
const options = () => ({ rootDir, runStop });
const authFile = () => path.join(rootDir, 'codex', 'home', 'auth.json');
const releases: Array<() => void> = [];

/** The env a gateway run on the installed Codex credential is spawned with. */
const codexRunEnv = async () => {
  const spawnEnv = await resolveAgentCredentialSpawnEnv('codex', {
    homeDir: tempDir,
    inheritedEnv: {},
    rootDir,
  });
  if (spawnEnv.kind !== 'spawn') throw new Error(`expected a spawn env, got ${spawnEnv.kind}`);
  return spawnEnv.env;
};

/**
 * A Codex run as `lh hetero exec` holds it: leased while the agent runs. On a
 * stop request it behaves like the real race: the agent renews the login it
 * started on and writes it back before exiting.
 */
const startRun = async (writesBackOnStop: string) => {
  const stops: string[] = [];
  const lease = trackAgentCredentialRun({
    env: await codexRunEnv(),
    heartbeatMs: 10,
    onStop: (reason) => {
      stops.push(reason);
      void writeFile(authFile(), writesBackOnStop).then(() => lease.release());
    },
  });
  releases.push(lease.release);
  return stops;
};

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'lh-agent-cred-runs-'));
  rootDir = path.join(tempDir, 'agent-credentials');
});

afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await rm(tempDir, { force: true, recursive: true });
});

describe('installAgentCredential with Codex runs on the previous login', () => {
  it('stops a run on the replaced account and keeps the new login it wrote over', async () => {
    await installAgentCredential(codexParams(chatgptAuth('user-a')), options());
    // The run renews account A while account B is being installed.
    const stops = await startRun(chatgptAuth('user-a', 'r2'));

    const result = await installAgentCredential(codexParams(chatgptAuth('user-b')), options());

    expect(result).toEqual({ installed: true, provider: 'codex', stoppedRuns: 1 });
    expect(stops).toEqual([CODEX_CREDENTIAL_REPLACED_REASON]);
    expect(await readFile(authFile(), 'utf8')).toBe(chatgptAuth('user-b'));
    // The stopped run's lease and stop request are cleaned up.
    expect(await readdir(path.join(rootDir, 'codex', 'runs'))).toEqual([]);
  });

  it('treats another user in the same ChatGPT account as a different login', async () => {
    await installAgentCredential(codexParams(chatgptAuth('user-a')), options());
    const stops = await startRun(chatgptAuth('user-a', 'r2'));

    await installAgentCredential(codexParams(chatgptAuth('user-c')), options());

    expect(stops).toHaveLength(1);
    expect(await readFile(authFile(), 'utf8')).toBe(chatgptAuth('user-c'));
  });

  it('stops a run that outlived the removal of its login', async () => {
    await installAgentCredential(codexParams(chatgptAuth('user-a')), options());
    const stops = await startRun(chatgptAuth('user-a', 'r2'));
    await removeAgentCredential({ provider: 'codex' }, options());

    await installAgentCredential(codexParams(chatgptAuth('user-b')), options());

    expect(stops).toHaveLength(1);
    expect(await readFile(authFile(), 'utf8')).toBe(chatgptAuth('user-b'));
  });

  it('leaves runs alone when the same login is reinstalled', async () => {
    await installAgentCredential(codexParams(chatgptAuth('user-a')), options());
    const stops = await startRun(chatgptAuth('user-a', 'r2'));

    await installAgentCredential(codexParams(chatgptAuth('user-a', 'r3')), options());

    expect(stops).toEqual([]);
    expect(await readFile(authFile(), 'utf8')).toBe(chatgptAuth('user-a', 'r3'));
  });

  it('stops runs when the previous login cannot be identified', async () => {
    await installAgentCredential(
      codexParams(JSON.stringify({ tokens: { access_token: 'opaque' } })),
      options(),
    );
    const stops = await startRun(JSON.stringify({ tokens: { access_token: 'opaque-2' } }));

    await installAgentCredential(codexParams(chatgptAuth('user-b')), options());

    expect(stops).toHaveLength(1);
    expect(await readFile(authFile(), 'utf8')).toBe(chatgptAuth('user-b'));
  });

  it('keeps the previous login when a run on it cannot be stopped', async () => {
    await installAgentCredential(codexParams(chatgptAuth('user-a')), options());
    const lease = trackAgentCredentialRun({
      env: await codexRunEnv(),
      heartbeatMs: 10,
      // Ignores the request; the test process itself must never be killed, so
      // the forced stop targets a pid that cannot be signalled.
      onStop: () => {},
      pid: process.pid,
    });
    releases.push(lease.release);

    const error = await installAgentCredential(codexParams(chatgptAuth('user-b')), {
      rootDir,
      runStop: { ...runStop, forceMs: 50, graceMs: 50, killRun: async () => {} },
    }).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('did not stop');
    expect(await readFile(authFile(), 'utf8')).toBe(chatgptAuth('user-a'));
    // The login was kept, so the run must not later report it as replaced.
    expect(await readdir(path.join(rootDir, 'codex', 'runs'))).toEqual([`${process.pid}.json`]);
  });

  it('lets the later of two overlapping replacements win', async () => {
    await installAgentCredential(codexParams(chatgptAuth('user-a')), options());
    // The run takes a while to stop, so both replacements wait on it.
    const lease = trackAgentCredentialRun({
      env: await codexRunEnv(),
      heartbeatMs: 10,
      onStop: () => {
        setTimeout(() => {
          void writeFile(authFile(), chatgptAuth('user-a', 'r2')).then(() => lease.release());
        }, 100);
      },
    });
    releases.push(lease.release);

    // B notices the run is gone only after C has finished, so B resumes last.
    const toB = installAgentCredential(codexParams(chatgptAuth('user-b')), {
      rootDir,
      runStop: { ...runStop, pollMs: 300 },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const toC = installAgentCredential(codexParams(chatgptAuth('user-c')), options());
    await Promise.all([toB, toC]);

    expect(await readFile(authFile(), 'utf8')).toBe(chatgptAuth('user-c'));
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'refuses the replacement when the leases cannot be listed',
    async () => {
      await installAgentCredential(codexParams(chatgptAuth('user-a')), options());
      const runs = path.join(rootDir, 'codex', 'runs');
      // Searchable but not readable: listing the leases fails.
      await chmod(runs, 0o300);
      try {
        await expect(
          installAgentCredential(codexParams(chatgptAuth('user-b')), options()),
        ).rejects.toThrow();
      } finally {
        await chmod(runs, 0o700);
      }
      expect(await readFile(authFile(), 'utf8')).toBe(chatgptAuth('user-a'));
    },
  );

  it('holds back a run that leases while the replacement is in progress', async () => {
    await installAgentCredential(codexParams(chatgptAuth('user-a')), options());
    let lateRunReads: string | undefined;
    const lease = trackAgentCredentialRun({
      env: await codexRunEnv(),
      heartbeatMs: 10,
      onStop: () => {
        // A new run is dispatched while the old one writes account A back.
        void (async () => {
          const late = trackAgentCredentialRun({
            env: await codexRunEnv(),
            heartbeatMs: 10,
            onStop: () => {},
          });
          releases.push(late.release);
          await writeFile(authFile(), chatgptAuth('user-a', 'r2'));
          lease.release();
          await late.admitted;
          lateRunReads = await readFile(authFile(), 'utf8');
        })();
      },
    });
    releases.push(lease.release);

    await installAgentCredential(codexParams(chatgptAuth('user-b')), options());

    // Admitted only after the installer restored B, so it never starts on A.
    await vi.waitFor(() => expect(lateRunReads).toBe(chatgptAuth('user-b')));
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'refuses the replacement when a lease cannot be inspected',
    async () => {
      await installAgentCredential(codexParams(chatgptAuth('user-a')), options());
      const runs = path.join(rootDir, 'codex', 'runs');
      await startRun(chatgptAuth('user-a', 'r2'));
      // Listable but not searchable: the lease is seen yet cannot be stat'ed.
      await chmod(runs, 0o600);
      try {
        await expect(
          installAgentCredential(codexParams(chatgptAuth('user-b')), options()),
        ).rejects.toThrow();
      } finally {
        await chmod(runs, 0o700);
      }
      expect(await readFile(authFile(), 'utf8')).toBe(chatgptAuth('user-a'));
    },
  );

  it('gives each run the lease directory in its spawn env', async () => {
    await installAgentCredential(codexParams(chatgptAuth('user-a')), options());

    expect((await codexRunEnv())[AGENT_CREDENTIAL_RUN_DIR_ENV]).toBe(
      path.join(rootDir, 'codex', 'runs'),
    );
  });
});
