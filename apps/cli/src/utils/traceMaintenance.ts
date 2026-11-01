import fs from 'node:fs/promises';
import path from 'node:path';

import { finalizeSnapshot, type ISnapshotStore } from '@lobechat/agent-tracing';

import { sumStepTokens } from './HeteroTraceRecorder';
import { createLocalTraceStore, resolveTraceDir } from './traceStore';

/**
 * How long a partial must go without a new step before it is treated as the
 * remains of a killed process rather than a live run.
 *
 * Deliberately generous: a single LLM turn can legitimately run for many
 * minutes, and finalizing a partial that is still being written would publish a
 * bogus `interrupted` snapshot for a run that is about to succeed. No real run
 * goes this long between steps.
 */
const ORPHAN_IDLE_MS = 6 * 60 * 60 * 1000;

/** Completed snapshots older than this are deleted on the next sweep. */
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const lastActivityAt = (partial: {
  startedAt?: number;
  steps?: Array<{ completedAt: number }>;
}): number => {
  const steps = partial.steps ?? [];
  const lastStep = steps.at(-1);
  return lastStep?.completedAt ?? partial.startedAt ?? 0;
};

/**
 * Turn partials left behind by killed processes into completed `interrupted`
 * snapshots.
 *
 * Without this a `kill -9` leaves the run visible only to `lh trace op inspect`
 * (which falls back to partials) and invisible to `lh trace op list` (which
 * lists completed snapshots) — the crashed runs, the ones most worth finding,
 * would be the ones that never show up.
 *
 * @returns number of partials reconciled.
 */
export const reconcileOrphanTraces = async (
  store: ISnapshotStore = createLocalTraceStore(),
  options?: { idleMs?: number; now?: number },
): Promise<number> => {
  const idleMs = options?.idleMs ?? ORPHAN_IDLE_MS;
  const now = options?.now ?? Date.now();

  let reconciled = 0;
  const partials = await store.listPartials().catch(() => []);

  for (const filename of partials) {
    const operationId = filename.replace(/\.json$/, '');
    const partial = await store.loadPartial(operationId).catch(() => null);
    if (!partial) continue;
    if (now - lastActivityAt(partial) < idleMs) continue;

    await finalizeSnapshot(store, operationId, {
      error: { message: 'Run ended without recording a result', type: 'interrupted' },
      reason: 'interrupted',
      totalCost: partial.totalCost ?? 0,
      totalSteps: partial.steps?.length ?? 0,
      // A killed run never emitted its session total, so the only truthful
      // number available is the sum of the turns it did record.
      totalTokens: partial.totalTokens || sumStepTokens(partial.steps),
    }).catch(() => {});
    reconciled += 1;
  }

  return reconciled;
};

/**
 * Delete completed snapshots older than the retention window.
 *
 * The store is a flat directory that only ever grows, and one long agent run
 * can be a multi-megabyte JSON — left alone it becomes the largest thing in the
 * CLI home. Partials are left to {@link reconcileOrphanTraces}, which turns
 * them into completed snapshots that this sweep then ages out normally.
 *
 * @returns number of snapshots deleted.
 */
export const pruneOldTraces = async (options?: {
  dir?: string;
  maxAgeMs?: number;
  now?: number;
}): Promise<number> => {
  const dir = options?.dir ?? resolveTraceDir();
  const maxAgeMs = options?.maxAgeMs ?? RETENTION_MS;
  const now = options?.now ?? Date.now();

  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  let deleted = 0;

  for (const entry of entries) {
    if (!entry.endsWith('.json') || entry === 'latest.json') continue;
    const filePath = path.join(dir, entry);
    // `lstat`, not `stat`: `latest.json` is filtered above, but a stale symlink
    // to a already-deleted snapshot would otherwise throw on stat.
    const stat = await fs.lstat(filePath).catch(() => null);
    if (!stat?.isFile()) continue;
    if (now - stat.mtimeMs < maxAgeMs) continue;

    await fs.unlink(filePath).catch(() => {});
    deleted += 1;
  }

  return deleted;
};

/**
 * Best-effort housekeeping for the local trace store. Safe to call on every
 * daemon start; never throws.
 */
export const sweepLocalTraces = async (): Promise<{ deleted: number; reconciled: number }> => {
  try {
    const reconciled = await reconcileOrphanTraces();
    const deleted = await pruneOldTraces();
    return { deleted, reconciled };
  } catch {
    return { deleted: 0, reconciled: 0 };
  }
};
