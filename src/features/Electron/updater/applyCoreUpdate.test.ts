import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyCoreUpdate } from './applyCoreUpdate';

const applyNowMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/electron/rendererOta', () => ({
  rendererOtaService: { applyNow: applyNowMock },
}));

describe('applyCoreUpdate', () => {
  beforeEach(() => {
    applyNowMock.mockReset();
  });

  it('reports failure when the main process refuses to apply', async () => {
    applyNowMock.mockResolvedValue(false);
    const onFailure = vi.fn();

    await expect(applyCoreUpdate(onFailure)).resolves.toBe(false);
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it('reports failure when the apply call throws', async () => {
    applyNowMock.mockRejectedValue(new Error('ipc down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onFailure = vi.fn();

    await expect(applyCoreUpdate(onFailure)).resolves.toBe(false);
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it('stays silent when the update is applied', async () => {
    applyNowMock.mockResolvedValue(true);
    const onFailure = vi.fn();

    await expect(applyCoreUpdate(onFailure)).resolves.toBe(true);
    expect(onFailure).not.toHaveBeenCalled();
  });
});
