import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { killProcessTree } from './kill';
import type {
  ProcessKillFilter,
  ProcessListFilter,
  ProcessRegistryEvent,
  ProcessRegistryListener,
  ProcessTags,
  RegisteredProcess,
} from './types';

export interface RegisterOptions {
  args?: string[];
  command: string;
  /** Override pgid detection. Defaults to proc.pid when proc was spawned detached on unix. */
  pgid?: number;
  process: ChildProcess;
  shellId?: string;
  tags: ProcessTags;
}

/**
 * In-process registry of all spawned child processes. Metadata only — stdout /
 * stderr buffering remains the caller's concern.
 *
 * Kill filters must include at least one of `shellId` or a scope tag
 * (`topicId` / `sessionId` / `toolCallId` / `ownerModule`). Empty filters are
 * rejected to avoid accidental kill-all.
 */
export class ProcessRegistry {
  private processes = new Map<string, RegisteredProcess>();
  private listeners = new Set<ProcessRegistryListener>();

  register(options: RegisterOptions): RegisteredProcess {
    const { process: child, command, args = [], tags, pgid, shellId = randomUUID() } = options;
    const pid = child.pid ?? 0;
    const hasPid = pid > 0;
    const entry: RegisteredProcess = {
      args,
      command,
      exitCode: null,
      pgid: pgid ?? (process.platform === 'win32' || !hasPid ? undefined : pid),
      pid,
      shellId,
      // A child without a pid failed to start synchronously (e.g. ENOENT).
      // Mark it exited immediately — the node 'error' event will fire on
      // nextTick, at which point `kill()` against it would be a no-op anyway.
      startedAt: Date.now(),
      status: hasPid ? 'running' : 'exited',
      tags,
    };
    if (!hasPid) entry.exitedAt = entry.startedAt;
    this.processes.set(shellId, entry);
    this.emit({ process: entry, type: 'registered' });
    if (!hasPid) this.emit({ process: entry, type: 'exited' });

    const onExit = (code: number | null) => {
      // Guard against post-forget() callbacks and killed-then-natural-exit races.
      if (!this.processes.has(shellId)) return;
      if (entry.status !== 'running') return;
      entry.status = 'exited';
      entry.exitCode = code;
      entry.exitedAt = Date.now();
      this.emit({ process: entry, type: 'exited' });
    };
    const onError = () => {
      if (!this.processes.has(shellId)) return;
      if (entry.status !== 'running') return;
      entry.status = 'exited';
      entry.exitedAt = Date.now();
      this.emit({ process: entry, type: 'exited' });
    };
    child.once('exit', onExit);
    child.once('error', onError);

    return entry;
  }

  list(filter: ProcessListFilter = {}): RegisteredProcess[] {
    return [...this.processes.values()].filter((p) => matches(p, filter));
  }

  get(shellId: string): RegisteredProcess | undefined {
    return this.processes.get(shellId);
  }

  /**
   * Kill all processes matching `filter`. Returns the shellIds that actually
   * received a signal. `ownerModule` alone is refused — kill-by-module could
   * span unrelated conversations; callers must narrow by `shellId` or at
   * least one of `topicId` / `sessionId` / `toolCallId`.
   */
  kill(filter: ProcessKillFilter, signal: NodeJS.Signals = 'SIGTERM'): string[] {
    if (!hasScope(filter)) {
      throw new Error(
        'ProcessRegistry.kill requires shellId, topicId, sessionId, or toolCallId (ownerModule alone is rejected)',
      );
    }

    const targets = [...this.processes.values()].filter((p) => matchesKill(p, filter));
    const killed: string[] = [];
    for (const entry of targets) {
      if (entry.status !== 'running') continue;
      killProcessTree(entry.pid, signal);
      entry.status = 'killed';
      entry.exitedAt = Date.now();
      this.emit({ process: entry, type: 'killed' });
      killed.push(entry.shellId);
    }
    return killed;
  }

  /** Force-delete an entry from the registry (e.g. after consumer drains buffers). */
  forget(shellId: string): void {
    this.processes.delete(shellId);
  }

  cleanupAll(signal: NodeJS.Signals = 'SIGTERM'): void {
    for (const entry of this.processes.values()) {
      if (entry.status === 'running') {
        killProcessTree(entry.pid, signal);
        entry.status = 'killed';
        entry.exitedAt = Date.now();
        this.emit({ process: entry, type: 'killed' });
      }
    }
    this.processes.clear();
  }

  subscribe(listener: ProcessRegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ProcessRegistryEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // listener error ignored; registry should not break on consumer faults
      }
    }
  }
}

function matches(p: RegisteredProcess, f: ProcessListFilter): boolean {
  if (f.ownerModule && p.tags.ownerModule !== f.ownerModule) return false;
  if (f.topicId && p.tags.topicId !== f.topicId) return false;
  if (f.sessionId && p.tags.sessionId !== f.sessionId) return false;
  if (f.toolCallId && p.tags.toolCallId !== f.toolCallId) return false;
  if (f.status && p.status !== f.status) return false;
  return true;
}

function hasScope(f: ProcessKillFilter): boolean {
  return !!(f.shellId || f.topicId || f.sessionId || f.toolCallId);
}

function matchesKill(p: RegisteredProcess, f: ProcessKillFilter): boolean {
  if (f.shellId && p.shellId !== f.shellId) return false;
  if (f.ownerModule && p.tags.ownerModule !== f.ownerModule) return false;
  if (f.topicId && p.tags.topicId !== f.topicId) return false;
  if (f.sessionId && p.tags.sessionId !== f.sessionId) return false;
  if (f.toolCallId && p.tags.toolCallId !== f.toolCallId) return false;
  return true;
}
