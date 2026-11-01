import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';

import type {
  CloseTerminalParams,
  CloseTerminalResult,
  CreateTerminalSessionParams,
  CreateTerminalSessionResult,
  ReadTerminalParams,
  ReadTerminalResult,
  ResizeTerminalParams,
  WriteTerminalParams,
} from '@lobechat/device-control';
import { detectWindowsShell } from '@lobechat/local-file-shell/shell';
import type { IPty } from '@lydell/node-pty';

/**
 * `@lydell/node-pty` is a native module: it ships a prebuilt binary per
 * platform and cannot be bundled, so it stays a real runtime dependency and is
 * marked external in `tsdown.config.ts`. It is also imported lazily, because
 * the CLI bundle is embedded in contexts that have no `node_modules` at all
 * (the desktop app runs it from `Resources/bin`) — a static import would make
 * every one of those fail at startup, while a host that never opens a terminal
 * never resolves this at all.
 */
const importPty = () => import('@lydell/node-pty');
let ptyModule: ReturnType<typeof importPty> | undefined;
const loadPty = () => (ptyModule ??= importPty());

/**
 * PTY sessions for the remote terminal, driven by the `createTerminalSession` /
 * `writeTerminal` / `readTerminal` / `resizeTerminal` / `closeTerminal` device
 * RPCs.
 *
 * Unlike the desktop app's local terminal — which pushes `onData` at the
 * renderer over IPC — the device RPC surface is strictly request/response, so
 * this manager keeps each session's output in a bounded buffer that the caller
 * drains with a cursor. It spawns a REAL pty rather than a piped child: that is
 * what makes `sudo` work, because `sudo` reads its password from `/dev/tty` and
 * only prompts when it has a controlling terminal. The password therefore flows
 * device-side only — it is never sent to, or stored by, the server.
 */

/** Hard cap on concurrent sessions; the least recently active one is evicted. */
const MAX_SESSIONS = 5;
/** Reap a session with no input and no output for this long. */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
/**
 * How long a session that has exited stays readable. `exit` and a failed
 * `sudo` both print on the way out, and dropping the session the moment the
 * shell dies would swallow that last output.
 */
const EXITED_TTL_MS = 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;
/**
 * Output kept per session. The oldest characters are dropped past this, which
 * only matters for a reader that stopped polling entirely — the dropped
 * characters are then simply missing from its stream.
 */
const MAX_BUFFER_CHARS = 1_000_000;
/** Output returned by a single read. A burst is drained by repeated reads. */
const MAX_CHUNK_CHARS = 128 * 1024;

interface TerminalSession {
  /** Characters already dropped from the front of {@link buffer}. */
  baseOffset: number;
  /** Rolling output; `baseOffset + buffer.length` is the session's cursor. */
  buffer: string;
  cwd: string;
  exitCode?: number;
  exited: boolean;
  /** Set once the shell exits, so the finished buffer can be reaped later. */
  exitedAt?: number;
  id: string;
  lastActiveAt: number;
  pid: number;
  pty?: IPty;
  shell: string;
}

export interface TerminalManagerOptions {
  logger?: { warn: (message: string) => void };
}

const resolveDefaultShell = async (): Promise<string> => {
  // Reuse the shared runCommand shell detection instead of ComSpec, which
  // effectively always points at cmd.exe.
  if (process.platform === 'win32') return (await detectWindowsShell()).path;
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
};

const isDirectory = async (candidate: string): Promise<boolean> => {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
};

export class TerminalSessionManager {
  private sessions = new Map<string, TerminalSession>();
  private sweepTimer: NodeJS.Timeout;

  constructor(private options: TerminalManagerOptions = {}) {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  async create(params: CreateTerminalSessionParams): Promise<CreateTerminalSessionResult> {
    this.evictLruIfFull();

    const id = `term_${randomUUID()}`;
    const shell = await resolveDefaultShell();
    const cwd = params.cwd && (await isDirectory(params.cwd)) ? params.cwd : os.homedir();
    const cols = params.cols > 0 ? params.cols : 80;
    const rows = params.rows > 0 ? params.rows : 24;

    const { spawn } = await loadPty();
    const pty = spawn(shell, [], {
      cols,
      cwd,
      env: {
        ...process.env,
        COLORTERM: 'truecolor',
        TERM: 'xterm-256color',
      } as Record<string, string>,
      name: 'xterm-256color',
      rows,
    });

    const session: TerminalSession = {
      baseOffset: 0,
      buffer: '',
      cwd,
      exited: false,
      id,
      lastActiveAt: Date.now(),
      pid: pty.pid,
      pty,
      shell,
    };
    this.sessions.set(id, session);

    pty.onData((data) => {
      session.lastActiveAt = Date.now();
      this.append(session, data);
    });
    pty.onExit(({ exitCode }) => {
      session.exitCode = exitCode;
      session.exited = true;
      session.exitedAt = Date.now();
      session.pty = undefined;
    });

    return { cwd, id, pid: pty.pid, shell };
  }

  write(params: WriteTerminalParams): void {
    const session = this.require(params.id);
    if (!session.pty) throw new Error(`Terminal session ${params.id} has exited`);
    session.lastActiveAt = Date.now();
    // Decoded back to bytes so the PTY receives exactly what the caller sent —
    // a keystroke and a partial UTF-8 sequence are both just bytes here.
    session.pty.write(Buffer.from(params.data, 'base64'));
  }

  read(params: ReadTerminalParams): ReadTerminalResult {
    const session = this.sessions.get(params.id);
    if (!session) {
      // A session this client no longer holds: the daemon restarted, the idle
      // sweep reaped it, or the LRU cap evicted it. That is not a transport
      // failure and the caller cannot bring it back, so answer the same way an
      // exited shell is answered — the reader closes its pane instead of
      // polling an id that will never be known here again. Reported rather than
      // thrown because throwing leaves every caller to recognise one message
      // string to tell "gone" apart from "the device is unreachable".
      this.options.logger?.warn(`terminal: read for unknown session ${params.id}`);
      return { chunk: '', exited: true, nextCursor: params.cursor };
    }
    session.lastActiveAt = Date.now();

    // A caller that fell behind the ring buffer is clamped forward rather than
    // refused: the terminal resumes at the oldest output still held.
    const start = Math.max(params.cursor, session.baseOffset);
    const available = session.baseOffset + session.buffer.length;
    const end = Math.min(available, start + MAX_CHUNK_CHARS);
    const chunk = session.buffer.slice(start - session.baseOffset, end - session.baseOffset);

    return {
      chunk: Buffer.from(chunk, 'utf8').toString('base64'),
      ...(session.exitCode === undefined ? {} : { exitCode: session.exitCode }),
      exited: session.exited,
      nextCursor: end,
    };
  }

  resize(params: ResizeTerminalParams): void {
    if (params.cols <= 0 || params.rows <= 0) return;
    const session = this.sessions.get(params.id);
    if (!session?.pty) return;
    session.lastActiveAt = Date.now();
    session.pty.resize(params.cols, params.rows);
  }

  close(params: CloseTerminalParams): CloseTerminalResult {
    const session = this.sessions.get(params.id);
    if (!session) return { closed: false };
    this.sessions.delete(params.id);
    if (session.pty) {
      try {
        session.pty.kill();
      } catch {
        /* already dead */
      }
    }
    return { closed: true };
  }

  /** Kill every live shell and stop sweeping. Called on daemon shutdown. */
  dispose(): void {
    clearInterval(this.sweepTimer);
    for (const session of this.sessions.values()) {
      try {
        session.pty?.kill();
      } catch {
        /* already dead */
      }
    }
    this.sessions.clear();
  }

  private append(session: TerminalSession, chunk: string) {
    session.buffer += chunk;
    if (session.buffer.length <= MAX_BUFFER_CHARS) return;
    const dropped = session.buffer.length - MAX_BUFFER_CHARS;
    session.buffer = session.buffer.slice(dropped);
    session.baseOffset += dropped;
  }

  private require(id: string): TerminalSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown terminal session: ${id}`);
    return session;
  }

  private evictLruIfFull() {
    while (this.sessions.size >= MAX_SESSIONS) {
      let lruId: string | undefined;
      let lruAt = Infinity;
      for (const [id, session] of this.sessions) {
        // An exited session is dead weight — it only lingers so its final
        // output can be read — so it is evicted before any live shell.
        const rank = session.exited ? -Infinity : session.lastActiveAt;
        if (rank < lruAt) {
          lruAt = rank;
          lruId = id;
        }
      }
      if (!lruId) return;
      this.options.logger?.warn(`terminal: evicting session ${lruId} (session limit)`);
      this.close({ id: lruId });
    }
  }

  private sweep() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      const expired = session.exited
        ? now - (session.exitedAt ?? session.lastActiveAt) > EXITED_TTL_MS
        : now - session.lastActiveAt > IDLE_TIMEOUT_MS;
      if (!expired) continue;
      this.options.logger?.warn(
        `terminal: reaping session ${id} (${session.exited ? 'exited' : 'idle'})`,
      );
      this.close({ id });
    }
  }
}
