// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveServerDefaultHeterogeneousCapability } from '../aiAgent';

const getSupportedModels = vi.hoisted(() => vi.fn());

vi.mock('@/server/modules/ModelRuntime', () => ({
  getServerDefaultHeterogeneousModels: getSupportedModels,
  SERVER_DEFAULT_HETEROGENEOUS_AGENT_TYPES: ['claude-code', 'codex'],
}));

describe('resolveServerDefaultHeterogeneousCapability', () => {
  beforeEach(() => {
    vi.stubEnv('ENABLE_SERVER_DEFAULT_HETEROGENEOUS_AGENT', '1');
    getSupportedModels.mockResolvedValue({
      'claude-code': [{ model: 'claude-sonnet-4-6' }],
      'codex': [{ model: 'gpt-5.4' }],
    });
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
      models: {
        'claude-code': [{ model: 'claude-sonnet-4-6' }],
        'codex': [{ model: 'gpt-5.4' }],
      },
    });

    expect(getSupportedModels).toHaveBeenCalledOnce();
  });

  it('advertises only agents that have a compatible runtime model', async () => {
    getSupportedModels.mockResolvedValue({
      'claude-code': [{ model: 'claude-sonnet-4-6' }],
      'codex': [],
    });

    await expect(resolveServerDefaultHeterogeneousCapability()).resolves.toMatchObject({
      agents: ['claude-code'],
      enabled: true,
    });
  });

  it('does not read the model catalog when the deployment feature is disabled', async () => {
    vi.stubEnv('ENABLE_SERVER_DEFAULT_HETEROGENEOUS_AGENT', '0');

    await expect(resolveServerDefaultHeterogeneousCapability()).resolves.toMatchObject({
      enabled: false,
      reason: 'disabled',
    });
    expect(getSupportedModels).not.toHaveBeenCalled();
  });

  it('reports an invalid configuration when the server catalog has no models', async () => {
    getSupportedModels.mockResolvedValue({ 'claude-code': [], 'codex': [] });

    await expect(resolveServerDefaultHeterogeneousCapability()).resolves.toMatchObject({
      enabled: false,
      reason: 'invalidConfiguration',
    });
  });

  it('reports an invalid configuration when the server catalog cannot be loaded', async () => {
    getSupportedModels.mockRejectedValue(new Error('invalid model catalog'));

    await expect(resolveServerDefaultHeterogeneousCapability()).resolves.toMatchObject({
      enabled: false,
      reason: 'invalidConfiguration',
    });
  });
});
