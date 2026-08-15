import type { PiRpcSession } from '@lobechat/heterogeneous-agents/rpc';

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
 * Concurrency note: the same key is naturally serial (one conversation runs
 * one turn at a time), so a busy entry is never reused; if a caller still
 * asks to register a replacement under a busy key, the old process is left
 * to finish rather than being killed mid-run.
 */
export class PiRpcPool {
  private readonly entries = new Map<string, PiRpcPoolEntry>();
  private readonly bySession = new Map<PiRpcSession, PiRpcPoolEntry>();

  constructor(
    private readonly options: {
      /** Idle grace before a pooled process is closed (EOF-first). */
      idleTimeoutMs: number;
      /** Observability hook, e.g. logging reaps. */
      onReap?: (key: string, reason: 'idle' | 'replaced' | 'removed' | 'shutdown') => void;
    },
  ) {}

  /** Reuse an idle pooled process for `key`, or `undefined` to spawn fresh. */
  acquire(key: string): PiRpcSession | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.session.isRunning) return undefined;

    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
    entry.lastUsedAt = Date.now();
    return entry.session;
  }

  /** Hand a freshly spawned process to the pool under `key`. */
  register(key: string, session: PiRpcSession): void {
    const existing = this.entries.get(key);
    if (existing && existing.session !== session) {
      // Replace: reap the old entry unless it is mid-run (never kill a run).
      if (existing.session.isRunning) {
        this.bySession.delete(existing.session);
        existing.session.close().catch(() => {
          /* best-effort */
        });
      } else {
        this.reap(existing, 'replaced');
      }
    }
    const entry: PiRpcPoolEntry = { key, lastUsedAt: Date.now(), session };
    this.entries.set(key, entry);
    this.bySession.set(session, entry);
  }

  /** The run settled — arm the idle reaper for this process. */
  release(session: PiRpcSession): void {
    const entry = this.bySession.get(session);
    if (!entry) return;
    entry.lastUsedAt = Date.now();
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => this.reap(entry, 'idle'), this.options.idleTimeoutMs);
    entry.idleTimer.unref?.();
  }

  /** The run failed — close the process and drop it. */
  remove(session: PiRpcSession): void {
    const entry = this.bySession.get(session);
    if (!entry) return;
    this.reap(entry, 'removed');
  }

  /** Close every pooled process (before-quit). */
  closeAll(): void {
    for (const entry of [...this.entries.values()]) this.reap(entry, 'shutdown');
  }

  private reap(entry: PiRpcPoolEntry, reason: 'idle' | 'replaced' | 'removed' | 'shutdown'): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = undefined;
    }
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    if (this.bySession.get(entry.session) === entry) this.bySession.delete(entry.session);
    this.options.onReap?.(entry.key, reason);
    void entry.session.close().catch(() => {
      /* best-effort */
    });
  }
}

interface PiRpcPoolEntry {
  idleTimer?: ReturnType<typeof setTimeout>;
  key: string;
  lastUsedAt: number;
  session: PiRpcSession;
}
