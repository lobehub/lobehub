// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BriefItem } from '@/database/schemas';

import { applyGoalBriefAction } from './goalBriefAction';

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  dispatchAcceptanceRepair: vi.fn(),
  reject: vi.fn(),
  settleSignOff: vi.fn(),
}));

const acceptance = { id: 'acc_1', subjectId: 'task_1', subjectType: 'task', userId: 'user-1' };

vi.mock('../acceptance', () => ({
  resolveAcceptanceForWrite: vi.fn(async () => ({
    acceptance,
    service: { accept: mocks.accept, reject: mocks.reject },
  })),
}));
vi.mock('./acceptanceRepairDispatch', () => ({
  dispatchAcceptanceRepair: mocks.dispatchAcceptanceRepair,
}));
vi.mock('@/server/services/goal/goalBriefs', () => ({
  GoalBriefService: vi.fn().mockImplementation(function () {
    return { settleSignOff: mocks.settleSignOff };
  }),
}));
vi.mock('@/server/services/goal', () => ({ GoalService: vi.fn() }));
vi.mock('@/server/services/goal/scheduler', () => ({ scheduleGoalAdvance: vi.fn() }));

const ctx = { serverDB: {} as any, userId: 'user-1', workspaceId: null } as any;
const signOffBrief = {
  metadata: { goal: { goalId: 'goal_1', kind: 'signOff', signOffAcceptanceId: 'acc_1' } },
} as unknown as BriefItem;

describe('applyGoalBriefAction sign-off', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('signs off from the inbox and settles the brief', async () => {
    expect(await applyGoalBriefAction(ctx, signOffBrief, 'signOff')).toBe(true);

    expect(mocks.accept).toHaveBeenCalledWith('acc_1', undefined);
    expect(mocks.settleSignOff).toHaveBeenCalledWith('acc_1', 'signOff', undefined);
  });

  it('sends the delivery back and hands it to the repair dispatch', async () => {
    expect(await applyGoalBriefAction(ctx, signOffBrief, 'requestChanges', 'Redo it')).toBe(true);

    expect(mocks.reject).toHaveBeenCalledWith('acc_1', 'Redo it');
    expect(mocks.dispatchAcceptanceRepair).toHaveBeenCalled();
  });
});
