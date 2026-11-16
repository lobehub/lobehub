// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assertPreciseScheduleAllowed } from './scheduleValidation';

const { checkPreciseScheduleAccess } = vi.hoisted(() => ({
  checkPreciseScheduleAccess: vi.fn(),
}));

vi.mock('@/business/server/task/preciseSchedule', () => ({ checkPreciseScheduleAccess }));

const actor = { userId: 'user-1', workspaceId: 'ws-1' };

describe('assertPreciseScheduleAllowed', () => {
  beforeEach(() => {
    checkPreciseScheduleAccess.mockReset();
    checkPreciseScheduleAccess.mockResolvedValue({ allowed: false, message: 'upgrade to pick' });
  });

  it('refuses a new exact minute with the deployment message', async () => {
    await expect(assertPreciseScheduleAllowed(actor, null, '17 9 * * *')).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'upgrade to pick',
    });
    expect(checkPreciseScheduleAccess).toHaveBeenCalledWith(actor);
  });

  it('refuses changing to a different exact minute', async () => {
    await expect(
      assertPreciseScheduleAllowed(actor, '17 9 * * *', '18 9 * * *'),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('passes when access is allowed', async () => {
    checkPreciseScheduleAccess.mockResolvedValue({ allowed: true });

    await expect(assertPreciseScheduleAllowed(actor, null, '17 9 * * *')).resolves.toBeUndefined();
  });

  it.each([
    ['a standard minute', '30 9 * * *', null],
    ['an interval', '*/15 * * * *', null],
    ['a cleared pattern', null, '17 9 * * *'],
    ['an untouched pattern', undefined, '17 9 * * *'],
    ['the stored minute on another hour or weekday', '17 10 * * 1', '17 9 * * *'],
  ])('does not check the plan for %s', async (_name, next, stored) => {
    await expect(assertPreciseScheduleAllowed(actor, stored, next)).resolves.toBeUndefined();
    expect(checkPreciseScheduleAccess).not.toHaveBeenCalled();
  });
});
