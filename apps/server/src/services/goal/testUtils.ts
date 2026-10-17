/** Shared helpers for the goal service tests: driving a batch through its release review. */
import { expect } from 'vitest';

import type { GoalService } from './index';

/** The release a passed batch gate is held for, still waiting on the owner. */
export const pendingRelease = async (service: GoalService, goalId: string) =>
  (await service.graph(goalId)).decisions.find(
    (decision) =>
      decision.status === 'pending' && decision.options?.some((option) => option.id === 'release'),
  );

/** Approve the release a passed batch gate is held for, as the owner would, and advance. */
export const approveRelease = async (service: GoalService, goalId: string) => {
  const pending = await pendingRelease(service, goalId);
  expect(pending).toBeDefined();
  await service.answerReleaseGate(pending!.nodeId, 'release');
  return service.tick(goalId);
};
