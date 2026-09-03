import type { GoalTraceSummary, GoalTrajectory } from '../types';

/**
 * Storage for goal trajectories. Mirrors `ISnapshotStore`: a finalized object
 * per goal plus an in-progress partial, because a goal is advanced from many
 * separate requests and has to accumulate across them.
 */
export interface IGoalTraceStore {
  get: (goalId: string) => Promise<GoalTrajectory | null>;
  list: (options?: { limit?: number }) => Promise<GoalTraceSummary[]>;
  listPartials: () => Promise<string[]>;
  loadPartial: (goalId: string) => Promise<Partial<GoalTrajectory> | null>;
  removePartial: (goalId: string) => Promise<void>;
  save: (trajectory: GoalTrajectory) => Promise<void>;
  savePartial: (goalId: string, partial: Partial<GoalTrajectory>) => Promise<void>;
}
