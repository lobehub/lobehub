import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { heterogeneousAgentCatalogService } from '@/services/heterogeneousAgent';

import { useModelCatalog } from './useModelCatalog';

const createWrapper = () => {
  const value = { provider: () => new Map() };

  return function SWRTestWrapper({ children }: PropsWithChildren) {
    return createElement(SWRConfig, { value }, children);
  };
};

describe('useModelCatalog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['codebuddy', 'cursor', 'opencode', 'pi', 'qoder'] as const)(
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
          useModelCatalog({
            isDeviceListLoading: false,
            isPreferenceLoading: false,
            open: false,
            provider: { type },
            targetReady: true,
            type,
          }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(listModels).toHaveBeenCalledTimes(1));
      expect(result.current.isLoading).toBe(true);
    },
  );

  it('does not preload the shared fallback while a member device preference is loading', async () => {
    const listModels = vi.spyOn(heterogeneousAgentCatalogService, 'listModels');

    const { result } = renderHook(
      () =>
        useModelCatalog({
          isDeviceListLoading: false,
          isPreferenceLoading: true,
          open: false,
          provider: { type: 'opencode' },
          targetReady: true,
          type: 'opencode',
        }),
      { wrapper: createWrapper() },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listModels).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it('waits for the device default directory before preloading the catalog', async () => {
    const pendingCatalog = new Promise<
      Awaited<ReturnType<typeof heterogeneousAgentCatalogService.listModels>>
    >(() => {});
    const listModels = vi
      .spyOn(heterogeneousAgentCatalogService, 'listModels')
      .mockReturnValue(pendingCatalog);
    const initialProps: { cwd?: string; isDeviceListLoading: boolean } = {
      cwd: undefined,
      isDeviceListLoading: true,
    };

    const { rerender } = renderHook(
      ({ cwd, isDeviceListLoading }: { cwd?: string; isDeviceListLoading: boolean }) =>
        useModelCatalog({
          cwd,
          deviceId: 'device-1',
          isDeviceListLoading,
          isPreferenceLoading: false,
          open: false,
          provider: { type: 'opencode' },
          targetReady: true,
          type: 'opencode',
        }),
      {
        initialProps,
        wrapper: createWrapper(),
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listModels).not.toHaveBeenCalled();

    rerender({ cwd: '/repo/device-default', isDeviceListLoading: false });

    await waitFor(() => expect(listModels).toHaveBeenCalledTimes(1));
    expect(listModels).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/repo/device-default', deviceId: 'device-1' }),
    );
  });

  it('does not load a catalog until its execution target is ready', async () => {
    const listModels = vi.spyOn(heterogeneousAgentCatalogService, 'listModels');

    renderHook(
      () =>
        useModelCatalog({
          isDeviceListLoading: false,
          isPreferenceLoading: false,
          open: false,
          provider: { type: 'opencode' },
          targetReady: false,
          type: 'opencode',
        }),
      { wrapper: createWrapper() },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(listModels).not.toHaveBeenCalled();
  });

  it('revalidates a failed preload when the selector opens', async () => {
    const failedCatalog = {
      error: { code: 'device_unavailable' as const, message: 'Device unavailable' },
      status: 'error' as const,
      updatedAt: 1,
    };
    const loadedCatalog = {
      models: [{ id: 'provider/model', modelId: 'model', providerId: 'provider' }],
      status: 'success' as const,
      updatedAt: 2,
    };
    let resolveRetry: (catalog: typeof loadedCatalog) => void = () => {};
    const retry = new Promise<typeof loadedCatalog>((resolve) => {
      resolveRetry = resolve;
    });
    const listModels = vi
      .spyOn(heterogeneousAgentCatalogService, 'listModels')
      .mockResolvedValueOnce(failedCatalog)
      .mockReturnValueOnce(retry);

    const { rerender, result } = renderHook(
      ({ open }) =>
        useModelCatalog({
          isDeviceListLoading: false,
          isPreferenceLoading: false,
          open,
          provider: { type: 'qoder' },
          targetReady: true,
          type: 'qoder',
        }),
      { initialProps: { open: false }, wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.error?.name).toBe('device_unavailable'));

    rerender({ open: true });

    await waitFor(() => expect(listModels).toHaveBeenCalledTimes(2));

    act(() => resolveRetry(loadedCatalog));

    await waitFor(() => expect(result.current.data).toEqual(loadedCatalog));
  });
});
