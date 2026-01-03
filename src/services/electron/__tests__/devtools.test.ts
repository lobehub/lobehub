import { describe, expect, it, vi } from 'vitest';

import { electronDevtoolsService } from '../devtools';

const openDevtoolsMock = vi.fn();
vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: vi.fn(() => ({
    devtools: { openDevtools: openDevtoolsMock },
  })),
}));
const { ensureElectronIpc } = await import('@/utils/electron/ipc');

describe('DevtoolsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('openDevtools', () => {
    it('should call dispatch with openDevtools', async () => {
      await electronDevtoolsService.openDevtools();
      expect(ensureElectronIpc).toHaveBeenCalled();
      expect(openDevtoolsMock).toHaveBeenCalled();
    });

    it('should return void when dispatch succeeds', async () => {
      openDevtoolsMock.mockResolvedValueOnce(undefined);
      const result = await electronDevtoolsService.openDevtools();
      expect(result).toBeUndefined();
    });

    it('should throw error when dispatch fails', async () => {
      const error = new Error('Failed to open devtools');
      openDevtoolsMock.mockRejectedValueOnce(error);

      await expect(electronDevtoolsService.openDevtools()).rejects.toThrow(error);
    });
  });
});
