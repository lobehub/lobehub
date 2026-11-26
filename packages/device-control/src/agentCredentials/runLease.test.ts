import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
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
});
