import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readFollowUpMode } from './followUpMode';

const mocks = vi.hoisted(() => ({ getUserPreference: vi.fn(), getUserSettings: vi.fn() }));
vi.mock('@/database/models/user', () => ({
  UserModel: vi.fn().mockImplementation(function () {
    return { getUserPreference: mocks.getUserPreference, getUserSettings: mocks.getUserSettings };
  }),
}));

const db = {} as any;
const lab = (enabled: boolean) => ({ lab: { enableBetterCodingExperience: enabled } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserSettings.mockResolvedValue(undefined);
});

describe('readFollowUpMode', () => {
  it('keeps the legacy behavior while the lab is off, without reading settings', async () => {
    mocks.getUserPreference.mockResolvedValue(lab(false));
    mocks.getUserSettings.mockResolvedValue({ general: { followUpBehavior: 'queue' } });

    await expect(readFollowUpMode(db, 'user-1')).resolves.toBe('legacy');
    expect(mocks.getUserSettings).not.toHaveBeenCalled();
  });

  it('defaults to steer with the lab on', async () => {
    mocks.getUserPreference.mockResolvedValue(lab(true));

    await expect(readFollowUpMode(db, 'user-1')).resolves.toBe('steer');
  });

  it('reads the stored setting with the lab on', async () => {
    mocks.getUserPreference.mockResolvedValue(lab(true));
    mocks.getUserSettings.mockResolvedValue({ general: { followUpBehavior: 'queue' } });

    await expect(readFollowUpMode(db, 'user-1')).resolves.toBe('queue');
  });

  it('falls back to the legacy behavior when the read fails', async () => {
    mocks.getUserPreference.mockRejectedValue(new Error('db down'));

    await expect(readFollowUpMode(db, 'user-1')).resolves.toBe('legacy');
  });
});
