import { beforeEach, describe, expect, it, vi } from 'vitest';

import { findDeploymentName } from './findDeploymentName';

const { mockGetModelListByProviderId } = vi.hoisted(() => ({
  mockGetModelListByProviderId: vi.fn(),
}));

vi.mock('@/database/models/aiModel', () => ({
  AiModelModel: vi.fn(() => ({
    getModelListByProviderId: mockGetModelListByProviderId,
  })),
}));

describe('findDeploymentName (server)', () => {
  const db = {} as any;
  const userId = 'user-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the configured deploymentName when present on the (model, provider) row', async () => {
    mockGetModelListByProviderId.mockResolvedValueOnce([
      { id: 'gpt-image-2', config: { deploymentName: 'my-dalle-deploy' } },
      { id: 'gpt-4o', config: { deploymentName: 'chat-deploy' } },
    ]);

    const resolved = await findDeploymentName(db, userId, 'gpt-image-2', 'azure');

    expect(resolved).toBe('my-dalle-deploy');
    expect(mockGetModelListByProviderId).toHaveBeenCalledWith('azure');
  });

  it('falls back to the model id when no row matches', async () => {
    mockGetModelListByProviderId.mockResolvedValueOnce([
      { id: 'gpt-4o', config: { deploymentName: 'chat-deploy' } },
    ]);

    const resolved = await findDeploymentName(db, userId, 'gpt-image-2', 'azure');

    expect(resolved).toBe('gpt-image-2');
  });

  it('falls back to the model id when the matching row has no deploymentName configured', async () => {
    mockGetModelListByProviderId.mockResolvedValueOnce([
      { id: 'gpt-image-2', config: {} },
    ]);

    const resolved = await findDeploymentName(db, userId, 'gpt-image-2', 'azure');

    expect(resolved).toBe('gpt-image-2');
  });

  it('falls back to the model id when config is null/undefined on the row', async () => {
    mockGetModelListByProviderId.mockResolvedValueOnce([
      { id: 'gpt-image-2', config: null },
    ]);

    const resolved = await findDeploymentName(db, userId, 'gpt-image-2', 'azure');

    expect(resolved).toBe('gpt-image-2');
  });

  it('ignores deploymentName from a different provider with the same model id', async () => {
    // Only the azure-provider rows are returned by getModelListByProviderId('azure'),
    // so a different provider's deployment mapping never leaks through.
    mockGetModelListByProviderId.mockResolvedValueOnce([
      { id: 'gpt-image-2', config: { deploymentName: 'azure-only-deploy' } },
    ]);

    const resolved = await findDeploymentName(db, userId, 'gpt-image-2', 'azure');

    expect(resolved).toBe('azure-only-deploy');
    expect(mockGetModelListByProviderId).toHaveBeenCalledWith('azure');
  });

  it('returns the original model id (does not throw) when the DB lookup fails', async () => {
    mockGetModelListByProviderId.mockRejectedValueOnce(new Error('db down'));

    const resolved = await findDeploymentName(db, userId, 'gpt-image-2', 'azure');

    expect(resolved).toBe('gpt-image-2');
  });

  it('treats an empty-string deploymentName as unset', async () => {
    mockGetModelListByProviderId.mockResolvedValueOnce([
      { id: 'gpt-image-2', config: { deploymentName: '' } },
    ]);

    const resolved = await findDeploymentName(db, userId, 'gpt-image-2', 'azure');

    expect(resolved).toBe('gpt-image-2');
  });
});
