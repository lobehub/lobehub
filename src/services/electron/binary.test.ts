import { beforeEach, describe, expect, it, vi } from 'vitest';

const binary = vi.hoisted(() => ({
  clearCache: vi.fn(),
  getAllStatus: vi.fn(),
  getCategories: vi.fn(),
  getInCategory: vi.fn(),
  getRegistered: vi.fn(),
  getStatus: vi.fn(),
}));

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({ binary }),
}));

describe('binaryService cached IPC wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('awaits sync main-process getters over IPC', async () => {
    const { binaryService } = await import('./binary');

    binary.getStatus.mockResolvedValue({ available: true });
    binary.getAllStatus.mockResolvedValue({ claude: { available: true } });
    binary.getRegistered.mockResolvedValue(['claude']);
    binary.getCategories.mockResolvedValue(['system']);
    binary.getInCategory.mockResolvedValue([{ name: 'claude' }]);
    binary.clearCache.mockResolvedValue(undefined);

    await expect(binaryService.getStatus('claude')).resolves.toEqual({ available: true });
    await expect(binaryService.getAllStatus()).resolves.toEqual({ claude: { available: true } });
    await expect(binaryService.getRegistered()).resolves.toEqual(['claude']);
    await expect(binaryService.getCategories()).resolves.toEqual(['system']);
    await expect(binaryService.getInCategory('system')).resolves.toEqual([{ name: 'claude' }]);
    await expect(binaryService.clearCache('claude')).resolves.toBeUndefined();

    expect(binary.getStatus).toHaveBeenCalledWith('claude');
    expect(binary.clearCache).toHaveBeenCalledWith('claude');
  });
});
