import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Leases for agent runs on an installed credential, so replacing the
 * credential can stop the runs still using the old one.
 *
 * Codex refreshes its login in place: a run started on account A rewrites
 * `CODEX_HOME/auth.json` with A's renewed tokens, so if account B was
 * installed meanwhile, every later run would bill A without any error. A
 * file lease (not an in-memory registry) is needed because the desktop app
 * and `lh connect` share one credential store, and the client installing a
 * credential may not be the one running the agent.
 *
 * The run wrapper (`lh hetero exec`) holds the lease: `<pid>.json`, its mtime
 * renewed as a heartbeat. An installer asks it to stop by writing
 * `<pid>.stop` (the reason), then waits for the lease to go.
 */

/** Spawn env naming the lease directory of the credential a run uses. */
export const AGENT_CREDENTIAL_RUN_DIR_ENV = 'LOBEHUB_AGENT_CREDENTIAL_RUN_DIR';

export const agentCredentialRunDir = (providerDir: string) => path.join(providerDir, 'runs');

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const LEASE_SUFFIX = '.json';
const STOP_SUFFIX = '.stop';
const REASON_MAX_LENGTH = 500;

const HEARTBEAT_MS = 1000;
/** A lease not renewed for this long belongs to a wrapper that died without cleanup. */
const STALE_MS = 10_000;
/** Time a run gets to stop on its own and report why, before it is killed. */
const GRACE_MS = 6000;
/** Time a killed run gets to disappear before the replacement gives up. */
const FORCE_MS = 2000;
const POLL_MS = 100;

const leaseFile = (runDir: string, pid: number) => path.join(runDir, `${pid}${LEASE_SUFFIX}`);
const stopFile = (runDir: string, pid: number) => path.join(runDir, `${pid}${STOP_SUFFIX}`);

export interface AgentCredentialRunLease {
  /** Drop the lease once the agent has exited; idempotent. */
  release: () => void;
}

export interface TrackAgentCredentialRunOptions {
  /** The run's env; only a run spawned on an installed credential carries the lease dir. */
  env: Record<string, string | undefined>;
  heartbeatMs?: number;
  /** Called once when an installer asks this run to stop, with the reason to report. */
  onStop: (reason: string) => void;
  /** The process signalled on a forced stop: the wrapper, leader of the agent's group. */
  pid?: number;
}

const NO_LEASE: AgentCredentialRunLease = { release: () => {} };

/**
 * Hold a lease for this run until `release` (or process exit). Synchronous on
 * purpose: the lease must exist before the agent reads the credential, or an
 * installer could replace the credential without seeing this run.
 */
export const trackAgentCredentialRun = ({
  env,
  heartbeatMs = HEARTBEAT_MS,
  onStop,
  pid = process.pid,
}: TrackAgentCredentialRunOptions): AgentCredentialRunLease => {
  const runDir = env[AGENT_CREDENTIAL_RUN_DIR_ENV]?.trim();
  if (!runDir) return NO_LEASE;

  const lease = leaseFile(runDir, pid);
  const stop = stopFile(runDir, pid);
  try {
    mkdirSync(runDir, { mode: DIR_MODE, recursive: true });
    // A stop request left by an earlier process with this pid is not for us.
    rmSync(stop, { force: true });
    writeFileSync(lease, JSON.stringify({ pid, startedAt: new Date().toISOString() }), {
      mode: FILE_MODE,
    });
  } catch {
    // Without a lease a replacement cannot stop this run, but failing the run
    // for that would be worse than the race the lease guards against.
    return NO_LEASE;
  }

  let stopped = false;
  let released = false;
  const timer = setInterval(() => {
    try {
      const now = new Date();
      utimesSync(lease, now, now);
    } catch {
      // Lease removed underneath us: nothing to renew.
    }
    if (stopped) return;
    let reason: string;
    try {
      reason = readFileSync(stop, 'utf8');
    } catch {
      return;
    }
    stopped = true;
    onStop(reason.trim().slice(0, REASON_MAX_LENGTH) || 'The installed credential was replaced.');
  }, heartbeatMs);
  timer.unref?.();

  const release = () => {
    if (released) return;
    released = true;
    clearInterval(timer);
    process.off('exit', release);
    rmSync(lease, { force: true });
    rmSync(stop, { force: true });
  };
  // Many exit paths call `process.exit` directly; the lease must not outlive them.
  process.once('exit', release);
  return { release };
};

const isPidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const killRunTree = async (pid: number) => {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => resolve());
      killer.once('exit', () => resolve());
    });
    return;
  }
  // The wrapper leads the agent's process group; fall back to the pid alone
  // for a wrapper started outside one.
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
};

interface LiveLease {
  file: string;
  pid: number;
}

/** Leases of runs that are still alive; stale ones are deleted on the way. */
const listLiveLeases = async (runDir: string, now: number, staleMs: number) => {
  const names = await readdir(runDir).catch(() => [] as string[]);
  const live: LiveLease[] = [];
  for (const name of names) {
    if (!name.endsWith(LEASE_SUFFIX)) continue;
    const pid = Number(name.slice(0, -LEASE_SUFFIX.length));
    const file = path.join(runDir, name);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const mtime = await stat(file).then(
      (s) => s.mtimeMs,
      () => undefined,
    );
    if (mtime === undefined) continue;
    // A lease that stopped renewing is never signalled: its pid may now
    // belong to an unrelated process.
    if (now - mtime > staleMs || !isPidAlive(pid)) {
      await rm(file, { force: true });
      await rm(stopFile(runDir, pid), { force: true });
      continue;
    }
    live.push({ file, pid });
  }
  return live;
};

const leaseGone = (lease: LiveLease) =>
  readFile(lease.file).then(
    () => !isPidAlive(lease.pid),
    () => true,
  );

const waitForLeases = async (leases: LiveLease[], timeoutMs: number, pollMs: number) => {
  const deadline = Date.now() + timeoutMs;
  let pending = leases;
  while (pending.length > 0) {
    const gone = await Promise.all(pending.map(leaseGone));
    pending = pending.filter((_, index) => !gone[index]);
    if (pending.length === 0 || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return pending;
};

export interface StopAgentCredentialRunsOptions {
  forceMs?: number;
  graceMs?: number;
  /** Kill a run's process tree; tests replace it so they never kill themselves. */
  killRun?: (pid: number) => Promise<void>;
  now?: () => number;
  pollMs?: number;
  staleMs?: number;
}

/**
 * Stop every live run holding a lease in `runDir` and wait until they are
 * gone: first by asking each to stop (so it reports `reason` as its error),
 * then by killing its process tree. Resolves with how many runs were stopped;
 * throws when a run outlives both, so the caller does not proceed as if the
 * old credential were no longer in use.
 */
export const stopAgentCredentialRuns = async (
  runDir: string,
  reason: string,
  options: StopAgentCredentialRunsOptions = {},
): Promise<number> => {
  const {
    forceMs = FORCE_MS,
    graceMs = GRACE_MS,
    killRun = killRunTree,
    now = Date.now,
    pollMs = POLL_MS,
    staleMs = STALE_MS,
  } = options;
  const leases = await listLiveLeases(runDir, now(), staleMs);
  if (leases.length === 0) return 0;

  await Promise.all(
    leases.map((lease) =>
      writeFile(stopFile(runDir, lease.pid), reason, { mode: FILE_MODE }).catch(() => {}),
    ),
  );
  let pending = await waitForLeases(leases, graceMs, pollMs);
  if (pending.length > 0) {
    await Promise.all(pending.map((lease) => killRun(lease.pid)));
    pending = await waitForLeases(pending, forceMs, pollMs);
  }
  if (pending.length > 0) {
    // The caller keeps the old credential, so a run that stops later must not
    // report it as replaced.
    await Promise.all(
      pending.map((lease) => rm(stopFile(runDir, lease.pid), { force: true }).catch(() => {})),
    );
    throw new Error(
      `${pending.length} agent run(s) on the installed credential did not stop (pid ${pending
        .map((lease) => lease.pid)
        .join(', ')})`,
    );
  }
  await Promise.all(
    leases.map(async (lease) => {
      await rm(lease.file, { force: true });
      await rm(stopFile(runDir, lease.pid), { force: true });
    }),
  );
  return leases.length;
};
