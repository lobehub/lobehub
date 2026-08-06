import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { heterogeneousAgentCatalogService } from '@/services/heterogeneousAgent';

import { useHeterogeneousAgentModelCatalog } from './useHeterogeneousAgentModelCatalog';

const createWrapper = () => {
  const value = { provider: () => new Map() };

  return function SWRTestWrapper({ children }: PropsWithChildren) {
    return createElement(SWRConfig, { value }, children);
  };
};

describe('useHeterogeneousAgentModelCatalog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['opencode', 'pi', 'qoder'] as const)(
    'starts loading the %s catalog as soon as the selector mounts',
    async (type) => {
      const pendingCatalog = new Promise<
        Awaited<ReturnType<typeof heterogeneousAgentCatalogService.listModels>>
      >(() => {});
      const listModels = vi
        .spyOn(heterogeneousAgentCatalogService, 'listModels')
        .mockReturnValue(pendingCatalog);

      const { result } = renderHook(
        () =>
          useHeterogeneousAgentModelCatalog({
            enabled: true,
            provider: { type },
            type,
          }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(listModels).toHaveBeenCalledTimes(1));
      expect(result.current.isLoading).toBe(true);
    },
  );

  it('does not load a catalog until its execution target is ready', async () => {
    const listModels = vi.spyOn(heterogeneousAgentCatalogService, 'listModels');

    const { result } = renderHook(
      () =>
        useHeterogeneousAgentModelCatalog({
          enabled: false,
          provider: { type: 'opencode' },
          type: 'opencode',
        }),
      { wrapper: createWrapper() },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listModels).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });
});
