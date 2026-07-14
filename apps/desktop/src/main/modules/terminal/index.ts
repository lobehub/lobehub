import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import os from 'node:os';

import type { IPty } from '@lydell/node-pty';
import { spawn } from '@lydell/node-pty';

export interface PtySessionCallbacks {
  onData: (id: string, data: string) => void;
  onExit: (id: string, exitCode: number) => void;
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

const getDefaultShell = () => {
  if (process.platform === 'win32') return process.env.ComSpec || 'powershell.exe';
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
};

/**
 * Owns the PTY processes for the in-app terminal. Sessions live in the main
 * process so they survive renderer-side panel collapse / remount; the renderer
 * only attaches an xterm view to the byte stream.
 */
export class PtySessionManager {
  private sessions = new Map<string, IPty>();

  constructor(private callbacks: PtySessionCallbacks) {}

  create(options: CreatePtySessionOptions): PtySessionInfo {
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

    this.sessions.set(id, pty);

    pty.onData((data) => this.callbacks.onData(id, data));
    pty.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      this.callbacks.onExit(id, exitCode);
    });

    return { cwd, id, pid: pty.pid, shell };
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0) return;
    this.sessions.get(id)?.resize(cols, rows);
  }

  kill(id: string): void {
    const pty = this.sessions.get(id);
    if (!pty) return;
    this.sessions.delete(id);
    pty.kill();
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  killAll(): void {
    for (const [id, pty] of this.sessions) {
      this.sessions.delete(id);
      try {
        pty.kill();
      } catch {
        /* already dead */
      }
    }
  }
}
