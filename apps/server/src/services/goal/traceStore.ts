import { FileGoalTraceStore, type IGoalTraceStore } from '@lobechat/agent-tracing';

import { S3GoalTraceStore } from '@/server/modules/GoalTracing';

import { shouldUseAgentS3Tracing } from '../agentRuntime/snapshotStore';

/**
 * Constructor injection for tests. Defaults are statically imported — never
 * load them through a dynamic `require(moduleName)`, which defeats the
 * bundler's `@/` alias resolution and silently yields a null store.
 */
export interface GoalTraceStoreFactories {
  createFile?: () => IGoalTraceStore;
  createS3?: () => IGoalTraceStore;
}

/**
 * Goal trajectories follow the same switch as operation snapshots, so a
 * deployment that records one records the other and a goal trace never points
 * at operation traces that were not kept.
 */
export const createDefaultGoalTraceStore = (
  factories: GoalTraceStoreFactories = {},
): IGoalTraceStore | null => {
  if (shouldUseAgentS3Tracing()) {
    try {
      return (factories.createS3 ?? (() => new S3GoalTraceStore()))();
    } catch (error) {
      // Best-effort, but loud: a swallowed failure here would leave production
      // goals with no trajectory and no sign of why.
      console.error('[goalTraceStore] failed to create S3GoalTraceStore, tracing disabled:', error);
      return null;
    }
  }

  if (process.env.NODE_ENV === 'development') {
    return (factories.createFile ?? (() => new FileGoalTraceStore()))();
  }

  return null;
};
