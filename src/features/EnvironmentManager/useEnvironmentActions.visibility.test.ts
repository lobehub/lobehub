import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { environmentService } from '@/services/environment';

import { useEnvironmentActions } from './useEnvironmentData';

const swr = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('swr', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSWRConfig: () => ({ mutate: swr.mutate }),
}));

vi.mock('@/services/environment', () => ({
  environmentService: { setEnvironmentVisibility: vi.fn() },
}));

describe('useEnvironmentActions.setEnvironmentVisibility', () => {
  beforeEach(() => {
    swr.mutate.mockReset().mockResolvedValue(undefined);
    vi.mocked(environmentService.setEnvironmentVisibility).mockResolvedValue({} as any);
  });

  it('should refresh every environment list, since publishing moves a row between them', async () => {
    const { result } = renderHook(() => useEnvironmentActions());

    await act(async () => {
      await result.current.setEnvironmentVisibility({ id: 'env-1', visibility: 'private' });
    });

    expect(environmentService.setEnvironmentVisibility).toHaveBeenCalledWith({
      id: 'env-1',
      visibility: 'private',
    });
    const [matchesKey] = swr.mutate.mock.calls[0];
    expect(matchesKey(['sandbox-environments', 'public'])).toBe(true);
    expect(matchesKey(['sandbox-environments', 'private'])).toBe(true);
    expect(matchesKey(['sandbox-drive-files'])).toBe(false);
  });
});
