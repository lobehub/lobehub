// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BriefItem } from '@/database/schemas';

import { applyGoalBriefAction } from './goalBriefAction';

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  archiveSignedOffGoalTasks: vi.fn(),
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
vi.mock('./acceptanceStatus', () => ({
  archiveSignedOffGoalTasks: mocks.archiveSignedOffGoalTasks,
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

  it('archives the goal Tasks after signing off from the inbox', async () => {
    expect(await applyGoalBriefAction(ctx, signOffBrief, 'signOff')).toBe(true);

    expect(mocks.accept).toHaveBeenCalledWith('acc_1', undefined);
    expect(mocks.archiveSignedOffGoalTasks).toHaveBeenCalledWith(ctx.serverDB, acceptance);
  });

  it('archives nothing when the delivery is sent back', async () => {
    expect(await applyGoalBriefAction(ctx, signOffBrief, 'requestChanges', 'Redo it')).toBe(true);

    expect(mocks.reject).toHaveBeenCalled();
    expect(mocks.archiveSignedOffGoalTasks).not.toHaveBeenCalled();
  });
});
