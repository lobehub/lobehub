import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
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
const exists = (target: string) =>
  stat(target).then(
    () => true,
    () => false,
  );

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
  it('drops a lease that stopped renewing without signalling its pid', async () => {
    await mkdir(runDir, { recursive: true });
    const file = path.join(runDir, `${process.pid}.json`);
    await writeFile(file, '{}');
    const old = new Date(Date.now() - 60_000);
    await utimes(file, old, old);
    const killRun = vi.fn(async () => {});

    expect(await stopAgentCredentialRuns(runDir, 'replaced', { killRun })).toBe(0);
    expect(killRun).not.toHaveBeenCalled();
    expect(await exists(file)).toBe(false);
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
