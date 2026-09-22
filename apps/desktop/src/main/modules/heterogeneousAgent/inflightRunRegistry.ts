import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { createLogger } from '@/utils/logger';

const logger = createLogger('modules:heterogeneousAgent:inflightRunRegistry');

/**
 * One local heterogeneous-agent CLI run this desktop process spawned and has
 * not seen exit yet. Everything a restart needs to pick the run back up: the
 * topic it belongs to (which owns the persisted rows and the `--resume` id),
 * the cwd the CLI session is keyed under, and the pid so an orphan left by a
 * crash can be reaped instead of burning quota headless.
 */
export interface HeteroInflightRun {
  agentId?: string;
  /** CLI-native session id (Claude Code `session_id`), known once the stream starts. */
  agentSessionId?: string;
  agentType: string;
  /**
   * Assistant row this run streams into. The only precise handle on the run's
   * own branch: a regenerated turn hangs several assistant branches off one
   * user row, and recovery must not touch the others.
   */
  assistantMessageId?: string;
  /** Basename of the spawned executable (e.g. `claude`), used to verify a pid before signalling it. */
  command?: string;
  /**
   * Effective Claude profile root (`CLAUDE_CONFIG_DIR`) the run spawned with —
   * a hosted binding profile, a quota-routed account, or an agent env override.
   * The transcript lives under it, so probing and replay must both use it.
   */
  configDir?: string;
  cwd?: string;
  /** Desktop IPC session id (`AgentSession.sessionId`). */
  ipcSessionId: string;
  operationId: string;
  pid?: number;
  /**
   * Path of the CLI script when the executable is a shared interpreter (an npm
   * `.cmd` shim unwraps to `node <cli-script>`). Pins the pid identity: `node`
   * on its own matches half the machine.
   */
  scriptPath?: string;
  /** ISO timestamp of the spawn. */
  startedAt: string;
  topicId?: string;
}

/** Runs older than this are dropped on read — their context is stale, not resumable. */
export const HETERO_INFLIGHT_RUN_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Crash-safe ledger of in-flight local CLI runs, kept as a small JSON file
 * under the app storage path.
 *
 * The desktop main process holds every session in memory only, and a clean
 * quit SIGTERMs each CLI child. Neither survives a restart, so without this
 * file the next launch has no way to know which topics were mid-run on THIS
 * machine (topic status alone cannot tell a run killed here from one still
 * running on another device). Writes are synchronous: entries are removed in
 * process-exit handlers that may race app shutdown, and the file is a few
 * hundred bytes.
 */
export class HeteroInflightRunRegistry {
  constructor(private readonly filePath: string) {}

  list(): HeteroInflightRun[] {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.runs) ? (parsed.runs as HeteroInflightRun[]) : [];
    } catch (error) {
      logger.warn('Discarding unreadable inflight-run registry:', error);
      return [];
    }
  }

  upsert(run: HeteroInflightRun): void {
    const runs = this.list().filter((item) => item.ipcSessionId !== run.ipcSessionId);
    runs.push(run);
    this.write(runs);
  }

  patch(ipcSessionId: string, update: Partial<HeteroInflightRun>): void {
    const runs = this.list();
    const index = runs.findIndex((item) => item.ipcSessionId === ipcSessionId);
    if (index < 0) return;
    runs[index] = { ...runs[index], ...update };
    this.write(runs);
  }

  remove(ipcSessionId: string): void {
    const runs = this.list();
    const next = runs.filter((item) => item.ipcSessionId !== ipcSessionId);
    if (next.length === runs.length) return;
    this.write(next);
  }

  /**
   * Hand every recorded run to the caller and clear the file, so a recovery
   * that itself dies cannot loop on the same entries at every launch.
   * Entries past {@link HETERO_INFLIGHT_RUN_MAX_AGE_MS} are dropped silently.
   */
  takeAll(now: number = Date.now()): HeteroInflightRun[] {
    const runs = this.list();
    if (runs.length === 0) return [];
    this.write([]);
    return runs.filter((run) => {
      const startedAt = Date.parse(run.startedAt);
      return Number.isFinite(startedAt) && now - startedAt <= HETERO_INFLIGHT_RUN_MAX_AGE_MS;
    });
  }

  private write(runs: HeteroInflightRun[]): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ runs, version: 1 }), 'utf8');
      renameSync(tmp, this.filePath);
    } catch (error) {
      logger.warn('Failed to write inflight-run registry:', error);
    }
  }
}
