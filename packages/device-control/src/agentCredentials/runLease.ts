import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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
 *
 * The lease also lists the agent's own process groups. Codex app-server runs
 * detached (its own group), so killing the wrapper's group misses it; a stop
 * waits for those groups to empty too, and a forced one kills them.
 */

/** Spawn env naming the lease directory of the credential a run uses. */
export const AGENT_CREDENTIAL_RUN_DIR_ENV = 'LOBEHUB_AGENT_CREDENTIAL_RUN_DIR';

export const agentCredentialRunDir = (providerDir: string) => path.join(providerDir, 'runs');

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const LEASE_SUFFIX = '.json';
const STOP_SUFFIX = '.stop';
const WRITE_SUFFIX = '.tmp';
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
  /**
   * Record a detached process group the agent started (`running`), or drop it
   * once its leader exited, so stopping the run also covers it.
   */
  setProcessGroup: (pgid: number, running: boolean) => void;
}

interface LeaseRecord {
  pid: number;
  processGroups: number[];
  startedAt: string;
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

const NO_LEASE: AgentCredentialRunLease = {
  admitted: Promise.resolve(),
  release: () => {},
  setProcessGroup: () => {},
};

/** Replace the lease in one step, so an installer never reads half a record. */
const writeLease = (lease: string, record: LeaseRecord) => {
  const pending = `${lease}${WRITE_SUFFIX}`;
  writeFileSync(pending, JSON.stringify(record), { mode: FILE_MODE });
  renameSync(pending, lease);
};

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
  const record: LeaseRecord = { pid, processGroups: [], startedAt: new Date().toISOString() };
  try {
    mkdirSync(runDir, { mode: DIR_MODE, recursive: true });
    // A stop request left by an earlier process with this pid is not for us.
    rmSync(stop, { force: true });
    writeLease(lease, record);
  } catch (error) {
    // Without a lease a replacement could not stop this run, which could then
    // write its login back over the next one: refuse the run instead.
    const message = error instanceof Error ? error.message : String(error);
    const admitted = Promise.reject(
      new Error(`Could not register this run on the installed credential: ${message}`),
    );
    admitted.catch(() => {});
    return { admitted, release: () => {}, setProcessGroup: () => {} };
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
    rmSync(`${lease}${WRITE_SUFFIX}`, { force: true });
    rmSync(stop, { force: true });
  };
  const setProcessGroup = (pgid: number, running: boolean) => {
    if (released || !Number.isInteger(pgid) || pgid <= 1) return;
    const groups = record.processGroups.filter((group) => group !== pgid);
    record.processGroups = running ? [...groups, pgid] : groups;
    try {
      writeLease(lease, record);
    } catch {
      // The lease still stands; only this group goes unrecorded.
    }
  };
  // Many exit paths call `process.exit` directly; the lease must not outlive them.
  process.once('exit', release);
  return { admitted, release, setProcessGroup };
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

/** A process group still has members (EPERM: they exist but belong to someone else). */
const isGroupAlive = (pgid: number) => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** `pid` is the wrapper, when it is still alive; `processGroups` the agent's detached groups. */
const killRunTree = async (pid: number | undefined, processGroups: number[]) => {
  if (process.platform === 'win32') {
    if (pid === undefined) return;
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
  if (pid !== undefined) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }
  for (const pgid of processGroups) {
    try {
      process.kill(-pgid, 'SIGKILL');
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
  /**
   * Detached agent groups the run must outlive: a wrapper that stops on
   * request can drop its lease before its app-server has finished exiting.
   */
  processGroups: number[];
}

/**
 * The agent groups a wrapper recorded, or `undefined` once its lease is gone.
 * A lease that cannot be read fails the replacement, as elsewhere.
 */
const readProcessGroups = async (lease: Pick<LiveLease, 'file' | 'pid'>) => {
  const text = await readFile(lease.file, 'utf8').catch(unlessMissing(undefined));
  if (text === undefined) return undefined;
  let record: Partial<LeaseRecord> | null = null;
  try {
    record = JSON.parse(text);
  } catch {
    // An older wrapper's lease (written in place) can read torn: no groups.
  }
  // App-server is not detached on Windows; `taskkill /T` already covers it.
  if (process.platform === 'win32') return [];
  const groups = Array.isArray(record?.processGroups) ? record.processGroups : [];
  return groups.filter(
    (pgid): pgid is number =>
      Number.isInteger(pgid) && pgid > 1 && pgid !== lease.pid && pgid !== process.pid,
  );
};

/**
 * A killable run's current groups (an app-server restart replaces its group)
 * while its wrapper is alive and holds the lease, else `undefined`. Groups are
 * only taken from a live wrapper, so no recorded id has had time to be reused.
 */
const readLiveWrapperGroups = async (lease: LiveLease) => {
  if (!lease.killable) return undefined;
  const groups = await readProcessGroups(lease);
  return groups && isPidAlive(lease.pid) ? groups : undefined;
};

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
    const killable = now - mtime <= staleMs;
    // A stale lease's groups are never trusted, like its pid.
    const processGroups = (killable && (await readProcessGroups({ file, pid }))) || [];
    live.push({ file, killable, pid, processGroups });
  }
  return live;
};

const leaseGone = async (lease: LiveLease) => {
  if (!lease.killable) {
    return readFile(lease.file).then(() => !isPidAlive(lease.pid), unlessMissing(true));
  }
  const groups = await readLiveWrapperGroups(lease);
  if (groups) {
    lease.processGroups = groups;
    return false;
  }
  // Wrapper gone: the last groups seen from it still have to empty.
  return !lease.processGroups.some(isGroupAlive);
};

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
  /**
   * Kill a run's process tree (`pid`, unset once the wrapper exited) and its
   * detached agent groups; tests replace it so they never kill themselves.
   */
  killRun?: (pid: number | undefined, processGroups: number[]) => Promise<void>;
  now?: () => number;
  pollMs?: number;
  staleMs?: number;
}

/**
 * Stop every live run holding a lease in `runDir` and wait until they are
 * gone: first by asking each to stop (so it reports `reason` as its error),
 * then by killing its process tree and the agent groups it recorded (a run
 * counts as gone only once those are empty too). Resolves with how many runs were stopped;
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
    await Promise.all(
      killable.map(async (lease) => {
        // A wrapper that already exited is not signalled (its pid may be
        // reused); only the groups it left behind are.
        const groups = await readLiveWrapperGroups(lease);
        if (groups) lease.processGroups = groups;
        await killRun(groups ? lease.pid : undefined, lease.processGroups);
      }),
    );
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
      `${pending.length} agent run(s) on the installed credential did not stop (${pending
        .map((lease) => {
          const groups = lease.processGroups.filter(isGroupAlive);
          return groups.length > 0
            ? `pid ${lease.pid}, groups ${groups.join(' ')}`
            : `pid ${lease.pid}`;
        })
        .join('; ')})`,
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
