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

  /**
   * Finalized and in-progress trajectories together, newest first.
   *
   * A long-horizon goal spends nearly all of its life as a partial, so a
   * listing that showed only finalized objects would report "nothing here" on
   * a machine that is actively running goals — while inspecting any one of
   * them by id worked fine.
   */
  async list(options?: { limit?: number }): Promise<GoalTraceSummary[]> {
    const limit = options?.limit ?? 10;

    const finalized = await Promise.all(
      (await this.listFiles()).map(async (file) => ({
        mtime: await mtimeOf(path.join(this.dir, file)),
        trajectory: await readJson<GoalTrajectory>(path.join(this.dir, file)),
      })),
    );
    const partials = await Promise.all(
      (await this.listPartials()).map(async (file) => {
        const filePath = path.join(this.partialDir(), file);
        const partial = await readJson<Partial<GoalTrajectory>>(filePath);
        return {
          mtime: await mtimeOf(filePath),
          trajectory: partial
            ? partialToTrajectory(partial.goalId ?? file.replace(/\.json$/, ''), partial)
            : null,
        };
      }),
    );

    // A goal that finalized while a stale partial lingered would otherwise show
    // twice; the finalized object wins because it is the complete one.
    const seen = new Set<string>();
    return [...finalized, ...partials]
      .flatMap((entry) => (entry.trajectory ? [{ ...entry, trajectory: entry.trajectory }] : []))
      .sort((a, b) => b.mtime - a.mtime)
      .filter(({ trajectory }) => {
        if (seen.has(trajectory.goalId)) return false;
        seen.add(trajectory.goalId);
        return true;
      })
      .slice(0, limit)
      .map(({ trajectory }) => toSummary(trajectory));
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

  private async listFiles(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.dir);
      return entries.filter((file) => file.endsWith('.json'));
    } catch {
      return [];
    }
  }
}

const safeName = (goalId: string): string => goalId.replaceAll(/[^\w-]/g, '_');

/** The file name is an id, so ordering has to come from the filesystem. */
const mtimeOf = async (filePath: string): Promise<number> =>
  fs
    .stat(filePath)
    .then((stat) => stat.mtimeMs)
    .catch(() => 0);

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
