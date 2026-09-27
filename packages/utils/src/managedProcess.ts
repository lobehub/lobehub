import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir, totalmem } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import debug from 'debug';

const log = debug('lobe-desktop:processes');
const exec = promisify(execFile);

export interface ProcessOwner {
  agentId?: string;
  label?: string;
  topicId?: string;
}

export interface ManagedProcessInfo extends ProcessOwner {
  cpuPercent: number | null;
  id: string;
  memoryMB: number;
  name: string;
  pid: number;
  ppid: number;
  rootId: string;
}

export interface ManagedProcessSnapshot {
  processes: ManagedProcessInfo[];
  sampledAt: number;
  totalMemoryMB: number;
}

interface ProcessIdentity {
  cpuTime: number;
  group: number;
  memoryMB: number;
  name: string;
  pid: number;
  ppid: number;
  started: string;
}

interface RootProcess {
  child: Pick<ChildProcess, 'exitCode' | 'signalCode'>;
  group: boolean;
  owner: ProcessOwner;
}

const exists = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
};

const signal = (pid: number, value: NodeJS.Signals) => {
  try {
    process.kill(pid, value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
};

const parseCpuTime = (value: string) => {
  const [days, clock] = value.includes('-') ? value.split('-') : ['0', value];
  return Number(days) * 86400 + clock.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
};

const readProcesses = async (): Promise<ProcessIdentity[]> => {
  if (process.platform === 'win32') {
    const { stdout } = await exec(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,WorkingSetSize,KernelModeTime,UserModeTime,Name | ConvertTo-Json -Compress',
      ],
      { timeout: 2000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
    const rows = JSON.parse(stdout) as Array<{
      ProcessId: number;
      ParentProcessId: number;
      CreationDate: string;
      WorkingSetSize: number;
      KernelModeTime: number;
      UserModeTime: number;
      Name: string;
    }>;
    return (Array.isArray(rows) ? rows : [rows]).map((row) => ({
      name: row.Name,
      memoryMB: Number(row.WorkingSetSize) / 1024 / 1024,
      cpuTime: (Number(row.KernelModeTime) + Number(row.UserModeTime)) / 10000000,
      pid: row.ProcessId,
      ppid: row.ParentProcessId,
      group: 0,
      started: row.CreationDate,
    }));
  }
  const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,pgid=,stat=,rss=,time=,lstart=,comm='], {
    timeout: 2000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C' },
  });
  return stdout
    .trim()
    .split('\n')
    .flatMap((line) => {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 12 || columns[3].startsWith('Z')) return [];
      return [
        {
          pid: Number(columns[0]),
          ppid: Number(columns[1]),
          group: Number(columns[2]),
          memoryMB: Number(columns[4]) / 1024,
          cpuTime: parseCpuTime(columns[5]),
          started: columns.slice(6, 11).join(' '),
          name: path.basename(columns.slice(11).join(' ')),
        },
      ];
    });
};

/** Host-owned process lifetime. No Electron dependency; CLI/server hosts opt in separately. */
export class ManagedProcessRegistry {
  private roots = new Map<number, RootProcess>();
  private descendants = new Map<number, ProcessIdentity>();
  private timer?: ReturnType<typeof setInterval>;
  private sampling?: Promise<void>;
  private closing?: Promise<void>;
  private stopping = false;
  private owners = new Map<number, { rootId: string; owner: ProcessOwner }>();
  private rows: ManagedProcessInfo[] = [];
  private sampledAt = 0;
  private browserScopes = new Map<string, ProcessOwner>();
  private browserActivity = new Map<string, number>();
  private idleStopping = new Set<string>();
  private browserBase = path.join(
    process.platform === 'darwin' ? '/tmp' : tmpdir(),
    `lb-${randomUUID().slice(0, 12)}`,
  );

  environment(owner: ProcessOwner, browserSession = 'default'): Record<string, string> {
    this.assertCanSpawn();
    const namespace = createHash('sha256')
      .update(owner.topicId ?? owner.agentId ?? 'shared')
      .digest('hex')
      .slice(0, 12);
    this.browserScopes.set(namespace, owner);
    this.browserActivity.set(namespace, Date.now());
    return {
      LOBEHUB_PROCESS_TOPIC: owner.topicId ?? '',
      LOBEHUB_PROCESS_AGENT: owner.agentId ?? '',
      LOBEHUB_PROCESS_LABEL: owner.label ?? '',
      AGENT_BROWSER_SOCKET_DIR: this.browserBase,
      AGENT_BROWSER_NAMESPACE: namespace,
      AGENT_BROWSER_SESSION: browserSession,
      AGENT_BROWSER_IDLE_TIMEOUT_MS: '900000',
    };
  }

  async snapshot(): Promise<ManagedProcessSnapshot> {
    // Share a recent sample across windows instead of measuring tiny CPU intervals.
    const age = Date.now() - this.sampledAt;
    if (!this.sampledAt || age < 0 || age >= 500) await this.sample();
    return {
      processes: this.rows,
      sampledAt: this.sampledAt,
      totalMemoryMB: totalmem() / 1024 / 1024,
    };
  }

  async stop(id: string) {
    await this.sample();
    const selected = this.rows.find((row) => row.id === id || row.rootId === id);
    if (!selected) throw new Error('Process has already exited');
    const rootId = selected.rootId;
    // Keep start identities: a recycled PID must never become a stop target.
    const targets = new Map(
      this.rows.filter((row) => row.rootId === rootId).map((row) => [row.pid, row.id]),
    );
    const terminate = async (value: NodeJS.Signals) => {
      await this.sample();
      for (const row of this.rows) {
        if (row.rootId !== rootId || (targets.has(row.pid) && targets.get(row.pid) !== row.id))
          continue;
        targets.set(row.pid, row.id);
        if (process.platform === 'win32') {
          try {
            await exec('taskkill', ['/pid', String(row.pid), '/T', '/F'], {
              timeout: 2000,
              windowsHide: true,
            });
          } catch (error) {
            if (exists(row.pid)) throw error;
          }
        } else signal(row.pid, value);
      }
    };
    await terminate('SIGTERM');
    await delay(1000);
    await terminate('SIGKILL');
    const deadline = Date.now() + 2000;
    do {
      await this.sample();
      if (!this.rows.some((row) => row.rootId === rootId)) return;
      await delay(50);
    } while (Date.now() < deadline);
    throw new Error('Activity remains after SIGKILL');
  }

  private async discoverBrowsers(processes: ProcessIdentity[]) {
    for (const [namespace, owner] of this.browserScopes) {
      const directory = path.join(this.browserBase, 'namespaces', namespace, 'run');
      let files: string[];
      try {
        files = await readdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      for (const file of files.filter((name) => name.endsWith('.pid'))) {
        let pid: number;
        let modified: number;
        try {
          pid = Number((await readFile(path.join(directory, file), 'utf8')).trim());
          modified = (await stat(path.join(directory, file))).mtimeMs;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        const row = processes.find(
          (item) => item.pid === pid && item.name.includes('agent-browser'),
        );
        if (!row || this.descendants.has(pid)) continue;
        // Reject a stale PID file pointing at a later, unrelated browser daemon.
        if (Date.parse(row.started) > modified + 1000) continue;
        this.descendants.set(pid, row);
        this.owners.set(pid, {
          rootId: `${pid}:${row.started}`,
          owner: { ...owner, label: `Agent Browser · ${file.slice(0, -4)}` },
        });
      }
    }
  }

  assertCanSpawn() {
    if (this.stopping) throw new Error('Application is shutting down; cannot start a process');
  }

  register(child: ChildProcess, detached: boolean, owner: ProcessOwner = {}) {
    if (!child.pid) return;
    log('register pid=%d detached=%s', child.pid, detached);
    if (this.roots.get(child.pid)?.child !== child) this.owners.delete(child.pid);
    this.roots.set(child.pid, { child, group: process.platform !== 'win32' && detached, owner });
    if (!this.timer) {
      // ponytail: polling can miss a daemon that detaches between samples; strict
      // containment needs a platform supervisor/job, not a faster polling loop.
      this.timer = setInterval(() => {
        void this.sample().catch((error) => console.error('Process tracking failed:', error));
      }, 1000);
      this.timer.unref();
    }
  }

  private sample(): Promise<void> {
    this.sampling ??= this.collect().finally(() => {
      this.sampling = undefined;
    });
    return this.sampling;
  }

  private async collect() {
    if (!this.roots.size && !this.descendants.size && !this.browserScopes.size) return;
    const roots = [...this.roots];
    const processes = await readProcesses();
    await this.discoverBrowsers(processes);
    const owned = new Set<number>();
    const now = Date.now();
    const prior = this.descendants;
    const assign = (row: ProcessIdentity, pid: number, owner: ProcessOwner) => {
      const root = processes.find((item) => item.pid === pid);
      const rootId = this.owners.get(pid)?.rootId ?? `${pid}:${root?.started ?? row.started}`;
      this.owners.set(row.pid, { rootId, owner });
      owned.add(row.pid);
    };
    for (const [pid, root] of roots) {
      if (root.group) {
        if (
          !exists(-pid) ||
          ((root.child.exitCode !== null || root.child.signalCode !== null) &&
            (!processes.some((row) => row.group === pid) ||
              processes.some((row) => row.pid === pid)))
        ) {
          this.roots.delete(pid);
          continue;
        }
        for (const row of processes) if (row.group === pid) assign(row, pid, root.owner);
      } else if (root.child.exitCode === null && root.child.signalCode === null) {
        const row = processes.find((item) => item.pid === pid);
        if (row) assign(row, pid, root.owner);
      } else {
        this.roots.delete(pid);
      }
    }
    for (const row of processes) {
      if (this.descendants.get(row.pid)?.started === row.started) owned.add(row.pid);
    }
    // A single process-table snapshot, expanded to a fixed point for arbitrary depth.
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of processes) {
        if (!owned.has(row.pid) && owned.has(row.ppid)) {
          owned.add(row.pid);
          const parent = this.owners.get(row.ppid);
          if (parent) this.owners.set(row.pid, parent);
          changed = true;
        }
      }
    }
    this.descendants = new Map(
      processes.filter((row) => owned.has(row.pid)).map((row) => [row.pid, row]),
    );
    this.rows = [...this.descendants.values()].map((row) => {
      const previous = prior.get(row.pid);
      const attribution = this.owners.get(row.pid);
      return {
        ...attribution?.owner,
        id: `${row.pid}:${row.started}`,
        rootId: attribution?.rootId ?? `${row.pid}:${row.started}`,
        pid: row.pid,
        ppid: row.ppid,
        name: row.name,
        memoryMB: row.memoryMB,
        cpuPercent:
          previous?.started === row.started && this.sampledAt && now > this.sampledAt
            ? Math.max(0, ((row.cpuTime - previous.cpuTime) * 100000) / (now - this.sampledAt))
            : null,
      };
    });
    this.sampledAt = now;
    // Old system agent-browser versions do not implement idle-timeout. Reap only
    // once all commands for this topic have ended and the reuse window expires.
    if (!this.stopping)
      for (const [namespace, owner] of this.browserScopes) {
        const active = [...this.roots.values()].some(
          (root) =>
            root.owner.topicId === owner.topicId &&
            root.owner.agentId === owner.agentId &&
            root.child.exitCode === null &&
            root.child.signalCode === null,
        );
        if (active) this.browserActivity.set(namespace, now);
        if (now - (this.browserActivity.get(namespace) ?? now) < 900000) continue;
        const browsers = this.rows.filter(
          (item) =>
            item.label?.startsWith('Agent Browser ·') &&
            item.topicId === owner.topicId &&
            item.agentId === owner.agentId,
        );
        if (!browsers.length) {
          this.browserScopes.delete(namespace);
          this.browserActivity.delete(namespace);
        }
        for (const row of browsers) {
          if (this.idleStopping.has(row.rootId)) continue;
          this.idleStopping.add(row.rootId);
          setTimeout(() => {
            void this.stop(row.rootId)
              .catch((error) => console.error('Browser idle cleanup failed:', error))
              .finally(() => this.idleStopping.delete(row.rootId));
          }, 0).unref();
        }
      }
    for (const pid of this.owners.keys()) if (!this.descendants.has(pid)) this.owners.delete(pid);
    if (!this.roots.size && !this.descendants.size && !this.browserScopes.size) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async terminate(value: NodeJS.Signals) {
    let sampled = true;
    try {
      await this.sample();
    } catch (error) {
      sampled = false;
      console.error('Cannot enumerate descendants; terminating registered roots:', error);
    }
    if (process.platform === 'win32') {
      const targets = sampled
        ? [...this.descendants.keys()]
        : [...this.roots]
            .filter(([, root]) => root.child.exitCode === null && root.child.signalCode === null)
            .map(([pid]) => pid);
      await Promise.all(
        targets.map(async (pid) => {
          try {
            await exec('taskkill', ['/pid', String(pid), '/T', '/F'], {
              timeout: 2000,
              windowsHide: true,
            });
          } catch (error) {
            if (exists(pid)) throw error;
          }
        }),
      );
      return;
    }
    for (const [pid, root] of this.roots) if (root.group) signal(-pid, value);
    if (sampled) for (const pid of this.descendants.keys()) signal(pid, value);
  }

  shutdown(graceMs = 2000): Promise<void> {
    log('shutdown roots=%o descendants=%o', [...this.roots.keys()], [...this.descendants.keys()]);
    this.stopping = true;
    this.closing ??= this.close(graceMs);
    return this.closing;
  }

  private async close(graceMs: number) {
    clearInterval(this.timer);
    this.timer = undefined;
    try {
      try {
        await this.terminate('SIGTERM');
        const deadline = Date.now() + graceMs;
        while ((this.roots.size || this.descendants.size) && Date.now() < deadline) {
          await delay(50);
          await this.sample();
        }
      } catch (error) {
        console.error('Graceful process shutdown failed:', error);
      }
      await this.terminate('SIGKILL');
      const killDeadline = Date.now() + 2000;
      while ((this.roots.size || this.descendants.size) && Date.now() < killDeadline) {
        await delay(50);
        await this.sample();
      }
      if (this.roots.size || this.descendants.size)
        throw new Error('Managed processes remain after SIGKILL');
    } finally {
      clearInterval(this.timer);
    }
  }
}

// Electron's eager and deferred CJS graphs can evaluate this module separately.
// The owner must belong to the host process, not to a particular module instance.
const registryKey = Symbol.for('lobehub.managedProcesses');
const host = globalThis as typeof globalThis & { [registryKey]?: ManagedProcessRegistry };

export const enableManagedProcesses = () => (host[registryKey] ??= new ManagedProcessRegistry());
export const managedProcessEnvironment = (owner: ProcessOwner, browserSession?: string) =>
  host[registryKey]?.environment(owner, browserSession) ?? {};
export const getManagedProcesses = () => enableManagedProcesses().snapshot();
export const stopManagedProcess = (id: string) => enableManagedProcesses().stop(id);
export const shutdownManagedProcesses = () => host[registryKey]?.shutdown() ?? Promise.resolve();

/** Preserve Node's spawn overloads, including typed stdio. Cleanup helpers use raw spawn. */
export const spawnManaged: typeof spawn = ((...args: Parameters<typeof spawn>) => {
  const registry = host[registryKey];
  log('spawn managed=%s', !!registry);
  registry?.assertCanSpawn();
  const child = spawn(...args);
  const options = (Array.isArray(args[1]) ? args[2] : (args[1] ?? args[2])) as
    SpawnOptions | undefined;
  registry?.register(child, options?.detached ?? false, {
    topicId: options?.env?.LOBEHUB_PROCESS_TOPIC || undefined,
    agentId: options?.env?.LOBEHUB_PROCESS_AGENT || undefined,
    label: options?.env?.LOBEHUB_PROCESS_LABEL || path.basename(args[0]),
  });
  return child;
}) as typeof spawn;

/** Keep ownership even when a sandbox intentionally filters the child environment. */
export const spawnManagedFor = (owner: ProcessOwner): typeof spawn =>
  ((...args: Parameters<typeof spawn>) => {
    const child = spawnManaged(...args);
    const options = (Array.isArray(args[1]) ? args[2] : (args[1] ?? args[2])) as
      SpawnOptions | undefined;
    host[registryKey]?.register(child, options?.detached ?? false, owner);
    return child;
  }) as typeof spawn;
