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
  /**
   * Hosted provider binding the CLI session belongs to, when the run had one.
   * A resume is dropped when its key does not match the binding this machine
   * resolves, so recovery has to restore it alongside the session id.
   */
  bindingKey?: string;
  /**
   * How many launches have taken this entry for recovery. The entry survives
   * a handover (see {@link HeteroInflightRunRegistry.claim}), so this is what
   * stops a recovery that keeps dying from being retried forever.
   */
  claimCount?: number;
  /** Basename of the spawned executable (e.g. `claude`), used to verify a pid before signalling it. */
  command?: string;
  /**
   * Effective Claude profile root (`CLAUDE_CONFIG_DIR`) the run spawned with —
   * a hosted binding profile, a quota-routed account, or an agent env override.
   * The transcript lives under it, so probing and replay must both use it.
   */
  configDir?: string;
  cwd?: string;
  /**
   * Set on {@link HeteroInflightRunRegistry.claim} when the entry is past
   * {@link HETERO_INFLIGHT_RUN_MAX_AGE_MS} or out of claims. Not replayable
   * any more, but its topic may still be parked mid-run, so the entry is
   * handed over for a status-only cleanup instead of being dropped silently.
   */
  expired?: boolean;
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
  /**
   * User the run belongs to. A personal-space run has no workspace, so the
   * account is the only thing separating two people sharing one install.
   */
  userId?: string;
  /**
   * Workspace the run belongs to. Topic lookups are workspace-scoped, so a
   * relaunch under a different workspace must leave this entry alone rather
   * than consume it and resolve the topic as missing.
   */
  workspaceId?: string;
}

/** Runs older than this are no longer replayed — their transcript is stale. */
export const HETERO_INFLIGHT_RUN_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Handovers one entry gets before it is spent. A recovery that dies mid-way
 * has to be retryable, but an entry that kills every launch it is handed to
 * must not come back a fourth time.
 */
export const HETERO_INFLIGHT_RUN_MAX_CLAIMS = 3;

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
   * Hand one run to a recovery attempt.
   *
   * The entry STAYS in the file: the renderer still has to reap, probe,
   * replay and settle, and if it dies (or the whole app crashes again) part
   * way through, this entry is the only token that can pick the topic back
   * up. {@link release} removes it once recovery has reached an outcome.
   *
   * The returned view is flagged `expired` when the entry is past
   * {@link HETERO_INFLIGHT_RUN_MAX_AGE_MS} or has used up its claims: too old
   * (or too dangerous) to replay, but the topic it left parked still needs a
   * status-only cleanup, and that last handover removes it right away so it
   * cannot be retried again.
   */
  claim(run: HeteroInflightRun, now: number = Date.now()): HeteroInflightRun {
    const claimCount = (run.claimCount ?? 0) + 1;
    const startedAt = Date.parse(run.startedAt);
    const tooOld = !Number.isFinite(startedAt) || now - startedAt > HETERO_INFLIGHT_RUN_MAX_AGE_MS;
    const spent = claimCount >= HETERO_INFLIGHT_RUN_MAX_CLAIMS;

    if (tooOld || spent) {
      this.remove(run.ipcSessionId);
      return { ...run, claimCount, expired: true };
    }
    this.patch(run.ipcSessionId, { claimCount });
    return { ...run, claimCount };
  }

  /**
   * Drop an entry whose recovery has reached an outcome. Called by the
   * renderer, which is the only side that knows the topic was settled.
   */
  release(ipcSessionId: string): void {
    this.remove(ipcSessionId);
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
