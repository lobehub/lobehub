import type { PiRpcSession } from '@lobechat/heterogeneous-agents/rpc';

import { createLogger } from '@/utils/logger';

const logger = createLogger('PiRpcPool');

/**
 * Cross-turn process pool for pi RPC runs.
 *
 * The renderer creates a fresh Electron IPC session per run, so a pi process
 * cannot be tied to one IPC session's lifetime. This pool keeps one
 * `pi --mode rpc` process alive across runs of the same conversation (keyed
 * by `cwd::nativeSessionId`) and reaps idle processes after a grace period —
 * the Codex app-server model applied to pi's single-session processes.
 *
 * Lifecycle:
 *   acquire(key)      → reused idle process, or undefined (caller spawns)
 *   register(key, s)  → hand a freshly spawned process to the pool
 *   release(s)        → run settled; arm the idle reaper
 *   remove(s)         → run failed; close and drop
 *   closeAll()        → before-quit
 *
 * Callers must await cancellation of the previous run before acquiring again.
 * A busy entry is an error, never a cache miss that permits a second writer.
 */
export class PiRpcPool {
  private readonly entries = new Map<string, PiRpcPoolEntry>();
  private readonly bySession = new Map<PiRpcSession, PiRpcPoolEntry>();
  private readonly closing = new Set<Promise<void>>();
  private shuttingDown = false;

  constructor(
    private readonly options: {
      /** Idle grace before a pooled process is closed (EOF-first). */
      idleTimeoutMs: number;
      /** Observability hook, e.g. logging reaps. */
      onReap?: (key: string, reason: 'idle' | 'replaced' | 'removed' | 'shutdown') => void;
    },
  ) {}

  /** Reuse an idle pooled process for `key`, or `undefined` to spawn fresh. */
  acquire(key: string, spawnFingerprint?: string): PiRpcSession | undefined {
    const entry = this.entries.get(key);
    // A process spawned under different runtime options (command path, args,
    // env) must not be reused — mirrors Codex app-server's canReuseFor.
    if (!entry) return undefined;
    if (entry.session.isRunning) throw new Error('Pi session still has an active run');
    if (!entry.session.isReusable) {
      this.reap(entry, 'removed');
      return undefined;
    }
    if (spawnFingerprint !== undefined && entry.spawnFingerprint !== spawnFingerprint) {
      return undefined;
    }

    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
    entry.lastUsedAt = Date.now();
    return entry.session;
  }

  /** Hand a freshly spawned process to the pool under `key`. */
  register(key: string, session: PiRpcSession, spawnFingerprint?: string): void {
    if (this.shuttingDown || !session.isReusable) {
      this.closeSession(session);
      return;
    }
    const existing = this.entries.get(key);
    if (existing && existing.session !== session) {
      // A replacement under the same key only happens after the previous
      // process was reaped (idle), failed, or was spawned under different
      // runtime options (spawnFingerprint mismatch). Runs of one conversation
      // are strictly serial on a single device, so the old process is never
      // busy here; reap it unconditionally for consistency.
      this.reap(existing, 'replaced');
    }
    const entry: PiRpcPoolEntry = { key, lastUsedAt: Date.now(), session, spawnFingerprint };
    this.entries.set(key, entry);
    this.bySession.set(session, entry);
  }

  /** The run settled — arm the idle reaper for this process. */
  release(session: PiRpcSession): void {
    const entry = this.bySession.get(session);
    if (!entry) return;
    if (!session.isReusable) {
      this.reap(entry, 'removed');
      return;
    }
    entry.lastUsedAt = Date.now();
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => this.reap(entry, 'idle'), this.options.idleTimeoutMs);
    entry.idleTimer.unref?.();
  }

  /** The run failed — close the process and drop it. */
  remove(session: PiRpcSession): void {
    const entry = this.bySession.get(session);
    if (!entry) {
      // Never registered — a fresh process that failed before the success
      // handoff. Close it directly or the pi child would outlive the run.
      this.closeSession(session);
      return;
    }
    this.reap(entry, 'removed');
  }

  /** Close every pooled process (before-quit). */
  async closeAll(): Promise<void> {
    this.shuttingDown = true;
    for (const entry of this.entries.values()) this.reap(entry, 'shutdown');
    while (this.closing.size > 0) await Promise.all(this.closing);
  }

  private reap(entry: PiRpcPoolEntry, reason: 'idle' | 'replaced' | 'removed' | 'shutdown'): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    if (this.bySession.get(entry.session) === entry) this.bySession.delete(entry.session);
    this.options.onReap?.(entry.key, reason);
    this.closeSession(entry.session);
  }

  private closeSession(session: PiRpcSession): void {
    const closing = session
      .close()
      .catch((error) => {
        logger.warn('Failed to close Pi RPC process:', error);
      })
      .finally(() => {
        this.closing.delete(closing);
      });
    this.closing.add(closing);
  }
}

interface PiRpcPoolEntry {
  idleTimer?: ReturnType<typeof setTimeout>;
  key: string;
  lastUsedAt: number;
  session: PiRpcSession;
  /** Runtime options the process was spawned with (command path, args, env). */
  spawnFingerprint?: string;
}
