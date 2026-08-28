import fs from 'node:fs/promises';
import path from 'node:path';

import type { GoalTraceSummary, GoalTrajectory } from '../types';
import type { IGoalTraceStore } from './types';

const DEFAULT_DIR = '.goal-tracing';
const PARTIAL_DIR = '_partial';

/**
 * Local-disk goal trajectories, the dev counterpart of `FileSnapshotStore`.
 *
 * Files are keyed by goal id rather than by timestamp: a goal id is stable for
 * the whole run, so there is exactly one object per goal and no name to
 * reconcile when it is finalized.
 */
export class FileGoalTraceStore implements IGoalTraceStore {
  private dir: string;

  constructor(rootDir?: string) {
    this.dir = path.resolve(rootDir ?? process.cwd(), DEFAULT_DIR);
  }

  private filePath(goalId: string): string {
    return path.join(this.dir, `${safeName(goalId)}.json`);
  }

  private partialDir(): string {
    return path.join(this.dir, PARTIAL_DIR);
  }

  private partialPath(goalId: string): string {
    return path.join(this.partialDir(), `${safeName(goalId)}.json`);
  }

  async save(trajectory: GoalTrajectory): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(
      this.filePath(trajectory.goalId),
      JSON.stringify(trajectory, null, 2),
      'utf8',
    );
  }

  async get(goalId: string): Promise<GoalTrajectory | null> {
    const finalized = await readJson<GoalTrajectory>(this.filePath(goalId));
    if (finalized) return finalized;

    // An in-flight goal is the common case for a tool used while debugging, so
    // fall through to the partial instead of reporting "no trace".
    const partial = await this.loadPartial(goalId);
    return partial ? partialToTrajectory(goalId, partial) : null;
  }

  async list(options?: { limit?: number }): Promise<GoalTraceSummary[]> {
    const limit = options?.limit ?? 10;
    const files = await this.listFiles();
    const summaries: GoalTraceSummary[] = [];

    for (const file of files.slice(0, limit)) {
      const trajectory = await readJson<GoalTrajectory>(path.join(this.dir, file));
      if (trajectory) summaries.push(toSummary(trajectory));
    }
    return summaries;
  }

  async listPartials(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.partialDir());
      return entries.filter((file) => file.endsWith('.json')).sort();
    } catch {
      return [];
    }
  }

  async loadPartial(goalId: string): Promise<Partial<GoalTrajectory> | null> {
    return readJson<Partial<GoalTrajectory>>(this.partialPath(goalId));
  }

  async savePartial(goalId: string, partial: Partial<GoalTrajectory>): Promise<void> {
    await fs.mkdir(this.partialDir(), { recursive: true });
    await fs.writeFile(this.partialPath(goalId), JSON.stringify(partial), 'utf8');
  }

  async removePartial(goalId: string): Promise<void> {
    try {
      await fs.unlink(this.partialPath(goalId));
    } catch {
      // already gone
    }
  }

  /** Newest first, by mtime — the file name is an id, so it cannot carry order. */
  private async listFiles(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.dir);
      const files = entries.filter((file) => file.endsWith('.json'));
      const stats = await Promise.all(
        files.map(async (file) => ({
          file,
          mtime: await fs
            .stat(path.join(this.dir, file))
            .then((stat) => stat.mtimeMs)
            .catch(() => 0),
        })),
      );
      return stats.sort((a, b) => b.mtime - a.mtime).map((entry) => entry.file);
    } catch {
      return [];
    }
  }
}

const safeName = (goalId: string): string => goalId.replaceAll(/[^\w-]/g, '_');

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function partialToTrajectory(
  goalId: string,
  partial: Partial<GoalTrajectory>,
): GoalTrajectory {
  const advances = partial.advances ?? [];
  return {
    ...partial,
    advances,
    goalId: partial.goalId ?? goalId,
    graphBaseline: partial.graphBaseline ?? {
      decisions: [],
      edges: [],
      goal: { id: goalId, status: 'unknown', title: partial.title ?? goalId },
      nodes: [],
    },
    startedAt: partial.startedAt ?? Date.now(),
    title: partial.title ?? goalId,
    totalAdvances: advances.length,
    totalTicks: advances.reduce((sum, advance) => sum + advance.ticks.length, 0),
    traceId: partial.traceId ?? goalId,
  };
}

export function toSummary(trajectory: GoalTrajectory): GoalTraceSummary {
  return {
    advances: trajectory.totalAdvances,
    completionReason: trajectory.completionReason,
    createdAt: trajectory.startedAt,
    durationMs: (trajectory.completedAt ?? Date.now()) - trajectory.startedAt,
    goalId: trajectory.goalId,
    title: trajectory.title,
  };
}
