import { describe, expect, it } from 'vitest';

import { resolveAssignmentActivityCopy } from './assignmentActivityCopy';

describe('resolveAssignmentActivityCopy', () => {
  it('reads as an assignment when the slot landed on someone', () => {
    expect(
      resolveAssignmentActivityCopy({
        from: null,
        kind: 'member',
        to: { avatar: null, id: 'user_bob', name: 'Bob', type: 'user' },
      }).verbKey,
    ).toBe('taskDetail.activities.assignment.memberAssigned');
  });

  it('reads as a removal when the slot was cleared', () => {
    expect(
      resolveAssignmentActivityCopy({
        from: { avatar: null, id: 'agt_1', name: 'Rika', type: 'agent' },
        kind: 'agent',
        to: null,
      }).verbKey,
    ).toBe('taskDetail.activities.assignment.agentUnassigned');
  });

  it('keeps the agent and member wordings apart', () => {
    const agentTarget = { avatar: null, id: 'agt_1', name: 'Rika', type: 'agent' } as const;
    expect(
      resolveAssignmentActivityCopy({ from: null, kind: 'agent', to: agentTarget }).verbKey,
    ).toBe('taskDetail.activities.assignment.agentAssigned');
    expect(resolveAssignmentActivityCopy({ from: null, kind: 'member', to: null }).verbKey).toBe(
      'taskDetail.activities.assignment.memberUnassigned',
    );
  });

  it('names the right deleted-target fallback per slot', () => {
    expect(resolveAssignmentActivityCopy({ from: null, kind: 'agent', to: null })).toMatchObject({
      deletedTargetKey: 'taskDetail.activities.assignment.deletedAgent',
    });
    expect(resolveAssignmentActivityCopy({ from: null, kind: 'member', to: null })).toMatchObject({
      deletedTargetKey: 'taskDetail.activities.assignment.deletedMember',
    });
  });
});
