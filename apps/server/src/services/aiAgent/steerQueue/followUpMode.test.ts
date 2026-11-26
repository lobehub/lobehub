import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readFollowUpMode } from './followUpMode';

const mocks = vi.hoisted(() => ({ getUserSettings: vi.fn() }));
vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(function () {
    return { getUserSettings: mocks.getUserSettings };
  }),
}));

const db = {} as any;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserSettings.mockResolvedValue(undefined);
});

describe('readFollowUpMode', () => {
  it('defaults to steer', async () => {
    await expect(readFollowUpMode(db, 'user-1')).resolves.toBe('steer');
  });

  it('reads the stored setting', async () => {
    mocks.getUserSettings.mockResolvedValue({ general: { followUpBehavior: 'queue' } });

    await expect(readFollowUpMode(db, 'user-1')).resolves.toBe('queue');
  });

  it('falls back to steer when the read fails', async () => {
    mocks.getUserSettings.mockRejectedValue(new Error('db down'));

    await expect(readFollowUpMode(db, 'user-1')).resolves.toBe('steer');
  });
});
