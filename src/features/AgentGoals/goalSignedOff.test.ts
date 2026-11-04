import { GOAL_ACCEPTANCE_TASK_TITLE } from '@lobechat/const/goal';
import { describe, expect, it } from 'vitest';

import { isGoalSnapshotSignedOff } from './goalSignedOff';

const snapshot = (status: string, acceptance?: string) =>
  ({
    acceptances: acceptance ? { node_acc: { id: 'acc_1', status: acceptance } } : {},
    goal: { status },
    nodes: [
      { id: 'node_work', kind: 'task', title: 'Draft the checklist' },
      { id: 'node_acc', kind: 'task', title: GOAL_ACCEPTANCE_TASK_TITLE },
    ],
  }) as never;

describe('isGoalSnapshotSignedOff', () => {
  it('is true once an achieved goal’s Goal-level acceptance is accepted', () => {
    expect(isGoalSnapshotSignedOff(snapshot('achieved', 'accepted'))).toBe(true);
  });

  it('is false while the sign-off is still open, or for a goal that is not achieved', () => {
    expect(isGoalSnapshotSignedOff(snapshot('achieved', 'delivered'))).toBe(false);
    expect(isGoalSnapshotSignedOff(snapshot('achieved'))).toBe(false);
    expect(isGoalSnapshotSignedOff(snapshot('running', 'accepted'))).toBe(false);
    expect(isGoalSnapshotSignedOff(undefined)).toBe(false);
  });
});
