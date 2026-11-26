import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
 * `<pid>.stop` (the reason), then waits for the lease to go. While an
 * installer replaces the credential it also holds `replacing-<id>`: a run
 * that leases meanwhile waits for it to go before starting its agent, so no
 * run can start on a login the installer is about to undo.
 */

/** Spawn env naming the lease directory of the credential a run uses. */
export const AGENT_CREDENTIAL_RUN_DIR_ENV = 'LOBEHUB_AGENT_CREDENTIAL_RUN_DIR';

export const agentCredentialRunDir = (providerDir: string) => path.join(providerDir, 'runs');

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const LEASE_SUFFIX = '.json';
const STOP_SUFFIX = '.stop';
const REPLACING_PREFIX = 'replacing-';
const REASON_MAX_LENGTH = 500;

const HEARTBEAT_MS = 1000;
/**
 * A lease not renewed for this long may belong to a wrapper that died and a
 * pid reused since, so it is asked to stop but never killed.
 */
const STALE_MS = 10_000;
/** A lease not renewed for this long is abandoned: no paused wrapper sleeps through it. */
const ABANDONED_MS = 60 * 60 * 1000;
/** Time a run gets to stop on its own and report why, before it is killed. */
const GRACE_MS = 6000;
/** Time a killed run gets to disappear before the replacement gives up. */
const FORCE_MS = 2000;
const POLL_MS = 100;
/** A replacement marker older than this belongs to an installer that died. */
const REPLACING_STALE_MS = 30_000;

const leaseFile = (runDir: string, pid: number) => path.join(runDir, `${pid}${LEASE_SUFFIX}`);
const stopFile = (runDir: string, pid: number) => path.join(runDir, `${pid}${STOP_SUFFIX}`);

export interface AgentCredentialRunLease {
  /**
   * Resolves once no replacement of the credential is in progress. Await it
   * after leasing and before the agent reads the credential.
   */
  admitted: Promise<void>;
  /** Drop the lease once the agent has exited; idempotent. */
  release: () => void;
}

export interface TrackAgentCredentialRunOptions {
  /** How long `admitted` waits out a replacement; tests shorten it. */
  admissionTimeoutMs?: number;
  /** The run's env; only a run spawned on an installed credential carries the lease dir. */
  env: Record<string, string | undefined>;
  heartbeatMs?: number;
  /** Called once when an installer asks this run to stop, with the reason to report. */
  onStop: (reason: string) => void;
  /** The process signalled on a forced stop: the wrapper, leader of the agent's group. */
  pid?: number;
}

const NO_LEASE: AgentCredentialRunLease = { admitted: Promise.resolve(), release: () => {} };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Only a missing file means "none"; any other failure must not admit a run blindly. */
const unlessMissing =
  <T>(fallback: T) =>
  (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  };

const replacementInProgress = async (runDir: string) => {
  const names = await readdir(runDir).catch(unlessMissing([] as string[]));
  for (const name of names) {
    if (!name.startsWith(REPLACING_PREFIX)) continue;
    const mtime = await stat(path.join(runDir, name)).then(
      (s) => s.mtimeMs,
      unlessMissing(undefined),
    );
    if (mtime !== undefined && Date.now() - mtime <= REPLACING_STALE_MS) return true;
  }
  return false;
};

/**
 * Wait (bounded by the stale age) until no installer is replacing the
 * credential. A marker directory that cannot be inspected counts as a
 * replacement in progress, and rejects once the wait runs out.
 */
const waitForAdmission = async (runDir: string, pollMs: number, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let error: unknown;
    const busy = await replacementInProgress(runDir).catch((caught) => {
      error = caught;
      return true;
    });
    if (!busy) return;
    if (Date.now() >= deadline) {
      if (error) throw error;
      return;
    }
    await sleep(pollMs);
  }
};

/**
 * Hold a lease for this run until `release` (or process exit). Synchronous on
 * purpose: the lease must exist before the agent reads the credential, or an
 * installer could replace the credential without seeing this run.
 */
export const trackAgentCredentialRun = ({
  admissionTimeoutMs = REPLACING_STALE_MS,
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
  } catch (error) {
    // Without a lease a replacement could not stop this run, which could then
    // write its login back over the next one: refuse the run instead.
    const message = error instanceof Error ? error.message : String(error);
    const admitted = Promise.reject(
      new Error(`Could not register this run on the installed credential: ${message}`),
    );
    admitted.catch(() => {});
    return { admitted, release: () => {} };
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

  const admitted = waitForAdmission(runDir, POLL_MS, admissionTimeoutMs);
  admitted.catch(() => {});

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
  return { admitted, release };
};

/**
 * Mark a replacement of the credential in progress until the returned `end`:
 * runs leasing meanwhile hold back their agent (see `admitted`).
 */
export const beginAgentCredentialReplacement = async (runDir: string) => {
  const marker = path.join(runDir, `${REPLACING_PREFIX}${randomUUID()}`);
  await mkdir(runDir, { mode: DIR_MODE, recursive: true });
  await writeFile(marker, '', { mode: FILE_MODE });
  return { end: () => rm(marker, { force: true }).catch(() => {}) };
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
  /** Renewed recently, so its pid is the wrapper's and may be killed. */
  killable: boolean;
  pid: number;
}

/** Leases of runs that are still alive; stale ones are deleted on the way. */
const listLiveLeases = async (
  runDir: string,
  now: number,
  staleMs: number,
  abandonedMs: number,
) => {
  // Only a missing directory means no runs: any other failure must stop the
  // replacement, or a run it cannot see would write the old login back.
  const names = await readdir(runDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [] as string[];
    throw error;
  });
  const live: LiveLease[] = [];
  for (const name of names) {
    if (!name.endsWith(LEASE_SUFFIX)) continue;
    const pid = Number(name.slice(0, -LEASE_SUFFIX.length));
    const file = path.join(runDir, name);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    // Only a lease that disappeared is skipped; one that cannot be read may
    // belong to a live run, so it fails the replacement.
    const mtime = await stat(file).then(
      (s) => s.mtimeMs,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      },
    );
    if (mtime === undefined) continue;
    // A lease that stopped renewing may be a wrapper that was paused (the
    // device slept) or a dead one whose pid was reused: it is still asked to
    // stop, but never killed, and the replacement fails if it does not go.
    if (now - mtime > abandonedMs || !isPidAlive(pid)) {
      await rm(file, { force: true });
      await rm(stopFile(runDir, pid), { force: true });
      continue;
    }
    live.push({ file, killable: now - mtime <= staleMs, pid });
  }
  return live;
};

const leaseGone = (lease: LiveLease) =>
  readFile(lease.file).then(
    () => !isPidAlive(lease.pid),
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return true;
      throw error;
    },
  );

const waitForLeases = async (leases: LiveLease[], timeoutMs: number, pollMs: number) => {
  const deadline = Date.now() + timeoutMs;
  let pending = leases;
  while (pending.length > 0) {
    const gone = await Promise.all(pending.map(leaseGone));
    pending = pending.filter((_, index) => !gone[index]);
    if (pending.length === 0 || Date.now() >= deadline) break;
    await sleep(pollMs);
  }
  return pending;
};

export interface StopAgentCredentialRunsOptions {
  abandonedMs?: number;
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
    abandonedMs = ABANDONED_MS,
    forceMs = FORCE_MS,
    graceMs = GRACE_MS,
    killRun = killRunTree,
    now = Date.now,
    pollMs = POLL_MS,
    staleMs = STALE_MS,
  } = options;
  const leases = await listLiveLeases(runDir, now(), staleMs, abandonedMs);
  if (leases.length === 0) return 0;

  await Promise.all(
    leases.map((lease) =>
      writeFile(stopFile(runDir, lease.pid), reason, { mode: FILE_MODE }).catch(() => {}),
    ),
  );
  let pending = await waitForLeases(leases, graceMs, pollMs);
  const killable = pending.filter((lease) => lease.killable);
  if (killable.length > 0) {
    await Promise.all(killable.map((lease) => killRun(lease.pid)));
    pending = [
      ...pending.filter((lease) => !lease.killable),
      ...(await waitForLeases(killable, forceMs, pollMs)),
    ];
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
