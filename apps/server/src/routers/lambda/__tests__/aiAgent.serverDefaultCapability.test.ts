// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveServerDefaultHeterogeneousCapability } from '../aiAgent';

const hasAvailableModel = vi.hoisted(() => vi.fn());

vi.mock('@/server/modules/ModelRuntime', () => ({
  hasAvailableServerModel: hasAvailableModel,
}));

describe('resolveServerDefaultHeterogeneousCapability', () => {
  beforeEach(() => {
    vi.stubEnv('ENABLE_SERVER_DEFAULT_HETEROGENEOUS_AGENT', '1');
    hasAvailableModel.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('reports the shared deployment model alias when the server catalog has a model', async () => {
    await expect(resolveServerDefaultHeterogeneousCapability()).resolves.toEqual({
      agents: ['claude-code', 'codex'],
      enabled: true,
      model: 'lobehub-default',
    });

    expect(hasAvailableModel).toHaveBeenCalledOnce();
  });

  it('does not read the model catalog when the deployment feature is disabled', async () => {
    vi.stubEnv('ENABLE_SERVER_DEFAULT_HETEROGENEOUS_AGENT', '0');

    await expect(resolveServerDefaultHeterogeneousCapability()).resolves.toMatchObject({
      enabled: false,
      reason: 'disabled',
    });
    expect(hasAvailableModel).not.toHaveBeenCalled();
  });

  it('reports an invalid configuration when the server catalog has no models', async () => {
    hasAvailableModel.mockResolvedValue(false);

    await expect(resolveServerDefaultHeterogeneousCapability()).resolves.toMatchObject({
      enabled: false,
      reason: 'invalidConfiguration',
    });
  });

  it('reports an invalid configuration when the server catalog cannot be loaded', async () => {
    hasAvailableModel.mockRejectedValue(new Error('invalid model catalog'));

    await expect(resolveServerDefaultHeterogeneousCapability()).resolves.toMatchObject({
      enabled: false,
      reason: 'invalidConfiguration',
    });
  });
});
