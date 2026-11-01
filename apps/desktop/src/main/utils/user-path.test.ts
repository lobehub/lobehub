import { app } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { safeGetPath } from './user-path';

vi.mock('electron', () => ({ app: { getPath: vi.fn() } }));
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ warn: vi.fn() }),
}));

describe('safeGetPath', () => {
  it('returns the resolved path', () => {
    vi.mocked(app.getPath).mockReturnValue('/home/u/Pictures');

    expect(safeGetPath('pictures')).toBe('/home/u/Pictures');
  });

  it('returns undefined instead of throwing when the folder cannot be resolved', () => {
    vi.mocked(app.getPath).mockImplementation(() => {
      throw new Error("Failed to get 'pictures' path");
    });

    expect(safeGetPath('pictures')).toBeUndefined();
  });
});
