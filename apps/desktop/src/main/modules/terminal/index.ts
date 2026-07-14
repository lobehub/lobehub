import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import os from 'node:os';

import type { IPty } from '@lydell/node-pty';
import { spawn } from '@lydell/node-pty';

export interface PtySessionCallbacks {
  onData: (id: string, data: string) => void;
  onExit: (id: string, exitCode: number) => void;
  /** Called when the manager kills a session itself (LRU cap / idle timeout). */
  onReap?: (id: string, reason: 'idle' | 'limit') => void;
}

export interface CreatePtySessionOptions {
  cols: number;
  cwd?: string;
  rows: number;
}

export interface PtySessionInfo {
  cwd: string;
  id: string;
  pid: number;
  shell: string;
}

/** Hard cap on concurrent PTY sessions; creating one more evicts the LRU session. */
const MAX_SESSIONS = 10;
/** Sessions with no input AND no output for this long get reaped. 5 min would be
 * too aggressive for a stateful shell (cwd/history/suspended jobs); anything
 * producing output — a running build, a tailing log — keeps itself alive. */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

interface PtySession {
  lastActiveAt: number;
  pty: IPty;
}

const getDefaultShell = () => {
  if (process.platform === 'win32') return process.env.ComSpec || 'powershell.exe';
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
};

/**
 * Owns the PTY processes for the in-app terminal. Sessions live in the main
 * process so they survive renderer-side panel collapse / remount; the renderer
 * only attaches an xterm view to the byte stream.
 *
 * Per-topic auto-spawn means sessions accumulate as the user browses topics, so
 * the manager enforces MAX_SESSIONS (LRU eviction) and reaps sessions idle past
 * IDLE_TIMEOUT_MS. Reaped sessions go through the normal onExit path, so the
 * renderer closes their tabs like any exited shell.
 */
export class PtySessionManager {
  private sessions = new Map<string, PtySession>();
  private sweepTimer: NodeJS.Timeout;

  constructor(private callbacks: PtySessionCallbacks) {
    this.sweepTimer = setInterval(() => this.reapIdleSessions(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  create(options: CreatePtySessionOptions): PtySessionInfo {
    this.evictLruIfFull();

    const id = `pty_${randomUUID()}`;
    const shell = getDefaultShell();
    const cwd = options.cwd && existsSync(options.cwd) ? options.cwd : os.homedir();

    const pty = spawn(shell, [], {
      cols: options.cols,
      cwd,
      env: {
        ...process.env,
        COLORTERM: 'truecolor',
        TERM: 'xterm-256color',
      } as Record<string, string>,
      name: 'xterm-256color',
      rows: options.rows,
    });

    const session: PtySession = { lastActiveAt: Date.now(), pty };
    this.sessions.set(id, session);

    pty.onData((data) => {
      session.lastActiveAt = Date.now();
      this.callbacks.onData(id, data);
    });
    pty.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      this.callbacks.onExit(id, exitCode);
    });

    return { cwd, id, pid: pty.pid, shell };
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.lastActiveAt = Date.now();
    session.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0) return;
    const session = this.sessions.get(id);
    if (!session) return;
    session.lastActiveAt = Date.now();
    session.pty.resize(cols, rows);
  }

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    session.pty.kill();
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  killAll(): void {
    clearInterval(this.sweepTimer);
    for (const [id, session] of this.sessions) {
      this.sessions.delete(id);
      try {
        session.pty.kill();
      } catch {
        /* already dead */
      }
    }
  }

  private evictLruIfFull() {
    while (this.sessions.size >= MAX_SESSIONS) {
      let lruId: string | undefined;
      let lruAt = Infinity;
      for (const [id, session] of this.sessions) {
        if (session.lastActiveAt < lruAt) {
          lruAt = session.lastActiveAt;
          lruId = id;
        }
      }
      if (!lruId) return;
      this.callbacks.onReap?.(lruId, 'limit');
      // kill() removes it from the map; pty.onExit still fires so the renderer
      // closes the evicted tab through the normal exit path.
      this.kill(lruId);
    }
  }

  private reapIdleSessions() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.lastActiveAt > IDLE_TIMEOUT_MS) {
        this.callbacks.onReap?.(id, 'idle');
        this.kill(id);
      }
    }
  }
}
