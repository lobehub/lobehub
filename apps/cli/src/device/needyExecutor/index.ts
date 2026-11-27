import { type ChildProcess, spawn as spawnProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import type { DeviceControlDeps } from '@lobechat/device-control';
import type {
  AttachNeedyExecutorParams,
  AttachNeedyExecutorResult,
  DetachNeedyExecutorResult,
} from '@lobechat/types';
import { z } from 'zod';

import { resolveCliDirName } from '../../constants/identity';
import { NEEDY_VERSION_PATTERN, NeedyRelease, resolveNeedyTarget } from './release';

/** Concurrent runners one device hosts; each is one session's executor. */
const MAX_ATTACHMENTS = 4;

/**
 * A runner that exits this soon after it starts failed to start (a refused
 * credential, an unreachable daemon), so attach reports it instead of
 * claiming success.
 */
const EARLY_EXIT_MS = 2000;

/** A runner still running this long after SIGTERM is killed. */
const STOP_GRACE_MS = 10_000;

/** Runner output kept in memory to explain an early exit. */
const OUTPUT_TAIL_LINES = 20;

/**
 * needy injects its guest into every actor at this path; a CLI that finds it
 * runs inside a needy actor, so its own execs are captured and routed.
 *
 * Source: https://github.com/needy-dev/needy/blob/de4a56b/crates/core-actor/src/contract.rs#L8
 */
const NEEDY_GUEST_DIR = '/.needy';

// One DNS name (RFC 1123 labels) or an IP address, nothing else: no scheme, no
// path, no userinfo. The device builds `tcp://HOST:PORT` from it.
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

const attachSchema = z.object({
  address: z.object({
    host: z.string().refine((host) => net.isIP(host) !== 0 || HOSTNAME_PATTERN.test(host)),
    port: z.number().int().min(1).max(65_535),
  }),
  // Names a private directory, so it is one path segment that starts plainly.
  attachmentId: z.string().regex(/^[a-z0-9][\w.-]{0,127}$/i),
  // Printable ASCII without spaces: it is written to a file, never to argv.
  credential: z.string().regex(/^[!-~]{1,4096}$/),
  runnerName: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  ttlSeconds: z.number().int().min(60).max(86_400),
  version: z.string().regex(NEEDY_VERSION_PATTERN),
}) satisfies z.ZodType<AttachNeedyExecutorParams>;

const detachSchema = z.object({ attachmentId: z.string().min(1).max(128) });

/** A validation error that names the bad fields, never their values (one is a secret). */
const parseParams = <T>(schema: z.ZodType<T>, params: unknown, what: string): T => {
  const result = schema.safeParse(params);
  if (result.success) return result.data;
  const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.') || '(root)'))];
  throw new Error(`invalid ${what} params: ${fields.join(', ')}`);
};

interface Attachment {
  child: ChildProcess;
  dir: string;
  exited: Promise<void>;
  expiresAt: number;
  fingerprint: string;
  runnerName: string;
  timer: ReturnType<typeof setTimeout>;
  version: string;
}

export interface NeedyExecutorSupervisorOptions {
  logger: { debug: (msg: string) => void; info: (msg: string) => void };
  /** Injected for tests. */
  now?: () => number;
  release: Pick<NeedyRelease, 'binary'>;
  /** Injected for tests; defaults to `child_process.spawn`. */
  spawn?: typeof spawnProcess;
  /** Holds one private directory per attachment (credential file and runner log). */
  stateDir: string;
}

/**
 * Runs needy executor runners for the server's attachments: one
 * `needy runner serve --roles executor --ephemeral` per attachment, dialing
 * the daemon named in the params with the credential written to a private
 * file. The command line is built here from validated fields; nothing from
 * the params reaches argv except the address, the name and needy's own flags.
 *
 * A runner ends on detach, when its TTL passes, when it exits on its own
 * (`--ephemeral` exits after its one bound run), or when `lh connect` stops.
 */
export class NeedyExecutorSupervisor {
  private readonly attachments = new Map<string, Attachment>();
  /** One attach or detach at a time per id, so a retried RPC cannot start two runners. */
  private readonly locks = new Map<string, Promise<unknown>>();
  /**
   * Ids between the capacity check and their runner being recorded. Locks are
   * per id, so attaches for different ids run concurrently; counting these
   * keeps them from all passing the check before any runner is recorded.
   */
  private readonly starting = new Set<string>();
  private disposed = false;

  constructor(private readonly options: NeedyExecutorSupervisorOptions) {}

  get size(): number {
    return this.attachments.size;
  }

  async attach(params: unknown): Promise<AttachNeedyExecutorResult> {
    const parsed = parseParams(attachSchema, params, 'attachNeedyExecutor');
    return this.serialize(parsed.attachmentId, () => this.attachLocked(parsed));
  }

  async detach(params: unknown): Promise<DetachNeedyExecutorResult> {
    const { attachmentId } = parseParams(detachSchema, params, 'detachNeedyExecutor');
    return this.serialize(attachmentId, async () => ({
      detached: await this.stop(attachmentId, 'detached'),
    }));
  }

  /**
   * Stop every runner now. Synchronous so it can run in a shutdown path that
   * exits right after: each runner gets SIGTERM and its private directory,
   * credential included, is removed.
   */
  dispose(): void {
    this.disposed = true;
    for (const [id, attachment] of this.attachments) {
      clearTimeout(attachment.timer);
      attachment.child.kill('SIGTERM');
      rmSync(attachment.dir, { force: true, recursive: true });
      this.attachments.delete(id);
    }
  }

  private async serialize<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    this.locks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
  }

  private async attachLocked(
    params: AttachNeedyExecutorParams,
  ): Promise<AttachNeedyExecutorResult> {
    if (this.disposed) throw new Error('lh connect is shutting down');
    const fingerprint = createHash('sha256').update(JSON.stringify(params)).digest('hex');

    const existing = this.attachments.get(params.attachmentId);
    if (existing && existing.fingerprint === fingerprint) {
      return this.result(params.attachmentId, existing, true);
    }
    // Same id, new params (a rotated credential, another daemon): replace it.
    if (existing) await this.stop(params.attachmentId, 'replaced');
    // The check and the reservation run with no await between them.
    if (this.attachments.size + this.starting.size >= MAX_ATTACHMENTS) {
      throw new Error(`this device already hosts ${MAX_ATTACHMENTS} needy executors`);
    }
    this.starting.add(params.attachmentId);
    try {
      return await this.start(params, fingerprint);
    } finally {
      this.starting.delete(params.attachmentId);
    }
  }

  private async start(
    params: AttachNeedyExecutorParams,
    fingerprint: string,
  ): Promise<AttachNeedyExecutorResult> {
    const now = this.options.now ?? Date.now;
    const binary = await this.options.release.binary(params.version);
    const dir = path.join(this.options.stateDir, params.attachmentId);
    await fs.rm(dir, { force: true, recursive: true });
    await fs.mkdir(dir, { mode: 0o700, recursive: true });
    const credentialFile = path.join(dir, 'credential');
    // needy refuses a credential file that other users can read.
    await fs.writeFile(credentialFile, params.credential, { mode: 0o600 });

    const host = net.isIPv6(params.address.host) ? `[${params.address.host}]` : params.address.host;
    const argv = [
      'runner',
      'serve',
      '--address',
      `tcp://${host}:${params.address.port}`,
      '--name',
      params.runnerName,
      // A file, not `--credential-env`: needy keeps the runner's environment for
      // the commands it runs, so an env var would reach every routed command.
      '--credential-file',
      credentialFile,
      '--roles',
      'executor',
      '--ephemeral',
    ];
    // TODO(needy-ingress): the cluster byte-stream ingress that admits external
    // runners by a signed route token is not built (needy design, PR #137 §4), so
    // the address is dialed directly. Add a `routeToken` field when it lands.

    const log = await fs.open(path.join(dir, 'runner.log'), 'a', 0o600);
    const tail: string[] = [];
    const remember = (chunk: Buffer) => {
      void log.write(chunk);
      tail.push(...chunk.toString('utf8').split('\n').filter(Boolean));
      tail.splice(0, Math.max(0, tail.length - OUTPUT_TAIL_LINES));
    };

    const child = (this.options.spawn ?? spawnProcess)(binary, argv, {
      cwd: os.homedir(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', remember);
    child.stderr?.on('data', remember);

    let exitDescription = '';
    const exited = new Promise<void>((resolve) => {
      child.once('error', (error) => {
        exitDescription = `could not start: ${error.message}`;
        resolve();
      });
      child.once('exit', (code, signal) => {
        exitDescription = signal ? `stopped by ${signal}` : `exited with code ${code}`;
        resolve();
      });
    }).finally(() => log.close().catch(() => {}));

    const expiresAt = now() + params.ttlSeconds * 1000;
    const attachment: Attachment = {
      child,
      dir,
      exited,
      expiresAt,
      fingerprint,
      runnerName: params.runnerName,
      timer: setTimeout(() => {
        void this.serialize(params.attachmentId, () => this.stop(params.attachmentId, 'expired'));
      }, params.ttlSeconds * 1000),
      version: params.version,
    };
    attachment.timer.unref?.();
    this.attachments.set(params.attachmentId, attachment);
    // Recorded now; stop counting it twice.
    this.starting.delete(params.attachmentId);

    void exited.then(() => {
      if (this.attachments.get(params.attachmentId) !== attachment) return;
      this.options.logger.info(
        `needy executor ${params.runnerName} (${params.attachmentId}) ${exitDescription}`,
      );
      this.forget(params.attachmentId, attachment);
    });

    const early = await Promise.race([
      exited.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), EARLY_EXIT_MS)),
    ]);
    if (early) {
      const detail = tail.length > 0 ? `: ${tail.join(' | ')}` : '';
      throw new Error(`needy runner ${exitDescription}${detail}`);
    }

    this.options.logger.info(
      `needy executor ${params.runnerName} started (needy ${params.version}, attachment ${params.attachmentId})`,
    );
    return this.result(params.attachmentId, attachment, false);
  }

  /** Stop one runner and remove its directory; `false` when nothing ran under `id`. */
  private async stop(id: string, reason: string): Promise<boolean> {
    const attachment = this.attachments.get(id);
    if (!attachment) return false;
    this.options.logger.debug(`stopping needy executor ${attachment.runnerName} (${reason})`);
    attachment.child.kill('SIGTERM');
    const killTimer = setTimeout(() => attachment.child.kill('SIGKILL'), STOP_GRACE_MS);
    killTimer.unref?.();
    await attachment.exited;
    clearTimeout(killTimer);
    this.forget(id, attachment);
    return true;
  }

  private forget(id: string, attachment: Attachment) {
    clearTimeout(attachment.timer);
    if (this.attachments.get(id) === attachment) this.attachments.delete(id);
    if (existsSync(attachment.dir)) rmSync(attachment.dir, { force: true, recursive: true });
  }

  private result(id: string, attachment: Attachment, reused: boolean): AttachNeedyExecutorResult {
    return {
      attachmentId: id,
      expiresAt: new Date(attachment.expiresAt).toISOString(),
      reused,
      runnerName: attachment.runnerName,
      version: attachment.version,
    };
  }
}

/** Where `lh` keeps needy releases and attachment state: `~/.lobehub/needy/`. */
export const needyRootDir = () => path.join(os.homedir(), resolveCliDirName(), 'needy');

/** A supervisor with the real release cache, for `lh connect`. */
export const createNeedyExecutorSupervisor = (logger: NeedyExecutorSupervisorOptions['logger']) =>
  new NeedyExecutorSupervisor({
    logger,
    release: new NeedyRelease({ cacheDir: path.join(needyRootDir(), 'releases') }),
    stateDir: path.join(needyRootDir(), 'attachments'),
  });

/** The device-control handlers that let the server attach needy executors here. */
export const createNeedyExecutorDeps = (
  supervisor: NeedyExecutorSupervisor,
): Pick<DeviceControlDeps, 'attachNeedyExecutor' | 'detachNeedyExecutor'> => ({
  attachNeedyExecutor: (params) => supervisor.attach(params),
  detachNeedyExecutor: (params) => supervisor.detach(params),
});

/**
 * What this machine can be in a needy mesh, for `system_info`: whether this CLI
 * runs inside a needy actor, and the needy build it would run as an executor.
 */
export const collectNeedyCapability = (
  guestDirExists: (dir: string) => boolean = existsSync,
): { actor: boolean; executor?: { target: string } } => {
  const target = resolveNeedyTarget();
  return {
    actor: guestDirExists(NEEDY_GUEST_DIR),
    ...(target && { executor: { target } }),
  };
};
