import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { INHERITED_RUN_IDENTITY_ENV_KEYS } from '@lobechat/heterogeneous-agents/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGENT_CREDENTIAL_RUN_DIR_ENV,
  beginAgentCredentialReplacement,
  stopAgentCredentialRuns,
  trackAgentCredentialRun,
} from './runLease';

let runDir: string;
const env = () => ({ [AGENT_CREDENTIAL_RUN_DIR_ENV]: runDir });

beforeEach(async () => {
  runDir = path.join(await mkdtemp(path.join(os.tmpdir(), 'lh-run-lease-')), 'runs');
});

afterEach(async () => {
  await rm(path.dirname(runDir), { force: true, recursive: true });
});

describe('trackAgentCredentialRun', () => {
  it('is never inherited by a run a launcher dispatches', () => {
    // A run without the installed credential must not lease it.
    expect(INHERITED_RUN_IDENTITY_ENV_KEYS).toContain(AGENT_CREDENTIAL_RUN_DIR_ENV);
  });

  it('holds no lease for a run without an installed credential', () => {
    const onStop = vi.fn();
    const lease = trackAgentCredentialRun({ env: {}, onStop });
    lease.release();
    expect(onStop).not.toHaveBeenCalled();
  });

  it('leases until released and reports a stop request once', async () => {
    const onStop = vi.fn();
    const lease = trackAgentCredentialRun({ env: env(), heartbeatMs: 10, onStop, pid: 4242 });
    expect(await readdir(runDir)).toEqual(['4242.json']);

    await writeFile(path.join(runDir, '4242.stop'), 'replaced\n');
    await vi.waitFor(() => expect(onStop).toHaveBeenCalledWith('replaced'));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(onStop).toHaveBeenCalledTimes(1);

    lease.release();
    expect(await readdir(runDir)).toEqual([]);
  });

  it('refuses the run when its lease cannot be created', async () => {
    await mkdir(path.dirname(runDir), { recursive: true });
    // A file where the lease directory belongs.
    await writeFile(runDir, '');
    const lease = trackAgentCredentialRun({ env: env(), onStop: () => {}, pid: 4242 });
    await expect(lease.admitted).rejects.toThrow('Could not register');
  });

  it('records the agent process groups it is told about', async () => {
    const lease = trackAgentCredentialRun({
      env: env(),
      heartbeatMs: 10,
      onStop: () => {},
      pid: 4242,
    });
    const record = async () =>
      JSON.parse(await readFile(path.join(runDir, '4242.json'), 'utf8')).processGroups;

    lease.setProcessGroup(5001, true);
    lease.setProcessGroup(5002, true);
    lease.setProcessGroup(5001, false);
    expect(await record()).toEqual([5002]);
    // Only the lease itself is left: the replacement never lands half-written.
    expect(await readdir(runDir)).toEqual(['4242.json']);

    lease.release();
    lease.setProcessGroup(5003, true);
    expect(await readdir(runDir)).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')(
    'holds the lease after the run until its app-server group exits',
    async () => {
      // An app-server that ignores the SIGTERM a normal close sends.
      const appServer = spawn(
        process.execPath,
        ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
        { detached: true, stdio: 'ignore' },
      );
      const exited = new Promise((resolve) => appServer.once('exit', resolve));
      const onStop = vi.fn();
      const lease = trackAgentCredentialRun({ env: env(), heartbeatMs: 10, onStop, pid: 4242 });
      lease.setProcessGroup(appServer.pid!, true);

      try {
        const released = lease.releaseAfterProcessGroups(200);
        // A replacement arriving now still sees the run, but the finished run
        // is not reported as stopped.
        await writeFile(path.join(runDir, '4242.stop'), 'replaced');
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(await readdir(runDir)).toContain('4242.json');

        await released;
        expect(await exited).toBeDefined();
        expect(await readdir(runDir)).toEqual([]);
        expect(onStop).not.toHaveBeenCalled();
      } finally {
        lease.release();
        appServer.kill('SIGKILL');
      }
    },
  );

  it('ignores a stop request left for an earlier process with the same pid', async () => {
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, '4242.stop'), 'old');
    const onStop = vi.fn();
    const lease = trackAgentCredentialRun({ env: env(), heartbeatMs: 10, onStop, pid: 4242 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    lease.release();
    expect(onStop).not.toHaveBeenCalled();
  });
});

describe('beginAgentCredentialReplacement', () => {
  it('holds back a run until the replacement ends', async () => {
    const replacement = await beginAgentCredentialReplacement(runDir);
    const lease = trackAgentCredentialRun({ env: env(), onStop: () => {}, pid: 4242 });
    let admitted = false;
    void lease.admitted.then(() => (admitted = true));

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(admitted).toBe(false);
    await replacement.end();
    await vi.waitFor(() => expect(admitted).toBe(true));
    lease.release();
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'refuses a run while the replacement markers cannot be inspected',
    async () => {
      const replacement = await beginAgentCredentialReplacement(runDir);
      const lease = trackAgentCredentialRun({
        admissionTimeoutMs: 300,
        env: env(),
        onStop: () => {},
        pid: 4242,
      });
      // Searchable but not readable: the markers cannot be listed.
      await chmod(runDir, 0o300);
      try {
        await expect(lease.admitted).rejects.toThrow();
      } finally {
        await chmod(runDir, 0o700);
        lease.release();
        await replacement.end();
      }
    },
  );

  it('ignores a marker left by an installer that died', async () => {
    const replacement = await beginAgentCredentialReplacement(runDir);
    const marker = (await readdir(runDir)).find((name) => name.startsWith('replacing-'))!;
    const old = new Date(Date.now() - 60_000);
    await utimes(path.join(runDir, marker), old, old);

    const lease = trackAgentCredentialRun({ env: env(), onStop: () => {}, pid: 4242 });
    await lease.admitted;
    lease.release();
    await replacement.end();
  });
});

describe('stopAgentCredentialRuns', () => {
  it('asks a paused run to stop but never kills it, failing if it stays', async () => {
    await mkdir(runDir, { recursive: true });
    // A live pid whose lease stopped renewing: a paused wrapper or a reused pid.
    const file = path.join(runDir, `${process.pid}.json`);
    await writeFile(file, '{}');
    const old = new Date(Date.now() - 60_000);
    await utimes(file, old, old);
    const killRun = vi.fn(async () => {});

    await expect(
      stopAgentCredentialRuns(runDir, 'replaced', {
        forceMs: 20,
        graceMs: 50,
        killRun,
        pollMs: 10,
      }),
    ).rejects.toThrow('did not stop');
    expect(killRun).not.toHaveBeenCalled();
    // Its stop request is withdrawn with the failed replacement.
    expect(await readdir(runDir)).toEqual([`${process.pid}.json`]);
  });

  it('accepts a paused run that stops once asked', async () => {
    const lease = trackAgentCredentialRun({
      env: env(),
      heartbeatMs: 10,
      onStop: () => lease.release(),
      pid: process.pid,
    });
    const killRun = vi.fn(async () => {});

    expect(
      await stopAgentCredentialRuns(runDir, 'replaced', { killRun, pollMs: 10, staleMs: -1 }),
    ).toBe(1);
    expect(killRun).not.toHaveBeenCalled();
  });

  it('drops leases of exited or long-abandoned runs', async () => {
    await mkdir(runDir, { recursive: true });
    const exited = spawn(process.execPath, ['-e', '']);
    await new Promise((resolve) => exited.once('exit', resolve));
    await writeFile(path.join(runDir, `${exited.pid}.json`), '{}');
    const abandoned = path.join(runDir, `${process.pid}.json`);
    await writeFile(abandoned, '{}');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(abandoned, old, old);

    expect(await stopAgentCredentialRuns(runDir, 'replaced')).toBe(0);
    expect(await readdir(runDir)).toEqual([]);
  });

  it('is a no-op without a lease directory', async () => {
    expect(await stopAgentCredentialRuns(runDir, 'replaced')).toBe(0);
  });

  it.skipIf(process.platform === 'win32')(
    'kills the process tree of a run that ignores the stop request',
    async () => {
      // A detached child leads its own group, like the `lh hetero exec` wrapper.
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        detached: true,
        stdio: 'ignore',
      });
      const exited = new Promise((resolve) => child.once('exit', resolve));
      const lease = trackAgentCredentialRun({
        env: env(),
        heartbeatMs: 10,
        onStop: () => {},
        pid: child.pid!,
      });

      try {
        expect(
          await stopAgentCredentialRuns(runDir, 'replaced', {
            forceMs: 2000,
            graceMs: 50,
            pollMs: 10,
          }),
        ).toBe(1);
        expect(await exited).toBeDefined();
      } finally {
        lease.release();
        child.kill('SIGKILL');
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'also kills the detached app-server group of a run killed outright',
    async () => {
      // Codex app-server runs detached, in a group of its own outside the
      // wrapper's; killing the wrapper group alone leaves it running.
      const spawnIdle = () =>
        spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          detached: true,
          stdio: 'ignore',
        });
      const wrapper = spawnIdle();
      const appServer = spawnIdle();
      const appServerExited = new Promise((resolve) => appServer.once('exit', resolve));
      const lease = trackAgentCredentialRun({
        env: env(),
        heartbeatMs: 10,
        onStop: () => {},
        pid: wrapper.pid!,
      });
      lease.setProcessGroup(appServer.pid!, true);

      try {
        expect(
          await stopAgentCredentialRuns(runDir, 'replaced', {
            forceMs: 2000,
            graceMs: 50,
            pollMs: 10,
          }),
        ).toBe(1);
        // Resolved only once the app-server group is gone too.
        expect(() => process.kill(-appServer.pid!, 0)).toThrow();
        expect(await appServerExited).toBeDefined();
      } finally {
        lease.release();
        wrapper.kill('SIGKILL');
        appServer.kill('SIGKILL');
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'waits for the app-server group of a run that drops its lease on request',
    async () => {
      const appServer = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        detached: true,
        stdio: 'ignore',
      });
      let appServerExited = false;
      appServer.once('exit', () => {
        appServerExited = true;
      });
      // The wrapper stops on request and drops its lease at once, while its
      // app-server is still shutting down.
      const lease = trackAgentCredentialRun({
        env: env(),
        heartbeatMs: 10,
        onStop: () => {
          lease.release();
          setTimeout(() => appServer.kill('SIGKILL'), 150);
        },
        pid: process.pid,
      });
      lease.setProcessGroup(appServer.pid!, true);
      const killRun = vi.fn(async () => {});

      try {
        expect(
          await stopAgentCredentialRuns(runDir, 'replaced', { graceMs: 2000, killRun, pollMs: 10 }),
        ).toBe(1);
        expect(appServerExited).toBe(true);
        expect(killRun).not.toHaveBeenCalled();
      } finally {
        lease.release();
        appServer.kill('SIGKILL');
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'kills only the groups left by a wrapper that already exited',
    async () => {
      const appServer = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        detached: true,
        stdio: 'ignore',
      });
      // The wrapper drops its lease on request but its app-server hangs.
      const lease = trackAgentCredentialRun({
        env: env(),
        heartbeatMs: 10,
        onStop: () => lease.release(),
        pid: process.pid,
      });
      lease.setProcessGroup(appServer.pid!, true);
      const killRun = vi.fn(async (_pid: number | undefined, groups: number[]) => {
        for (const pgid of groups) process.kill(-pgid, 'SIGKILL');
      });

      try {
        expect(
          await stopAgentCredentialRuns(runDir, 'replaced', {
            forceMs: 2000,
            graceMs: 50,
            killRun,
            pollMs: 10,
          }),
        ).toBe(1);
        // The wrapper pid is no longer the run's, so it is never signalled.
        expect(killRun).toHaveBeenCalledWith(undefined, [appServer.pid]);
      } finally {
        lease.release();
        appServer.kill('SIGKILL');
      }
    },
  );

  it('hands the recorded groups to the killer and waits for them', async () => {
    const lease = trackAgentCredentialRun({
      env: env(),
      heartbeatMs: 10,
      onStop: () => {},
      pid: process.pid,
    });
    lease.setProcessGroup(process.pid, true);
    lease.setProcessGroup(4_000_000, true);
    const killRun = vi.fn(async () => {
      lease.release();
    });

    try {
      await stopAgentCredentialRuns(runDir, 'replaced', {
        forceMs: 50,
        graceMs: 20,
        killRun,
        pollMs: 10,
      });
      // The wrapper's own pid is never treated as a second group.
      expect(killRun).toHaveBeenCalledWith(
        process.pid,
        process.platform === 'win32' ? [] : [4_000_000],
      );
    } finally {
      lease.release();
    }
  });
});
