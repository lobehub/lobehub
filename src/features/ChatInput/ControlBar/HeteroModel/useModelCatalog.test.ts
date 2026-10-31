/**
 * @vitest-environment happy-dom
 */
import { randomUUID } from 'node:crypto';

import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { createElement, useEffect } from 'react';
import { SWRConfig, useSWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { setScopedMutate } from '@/libs/swr/mutate';
import { heterogeneousAgentCatalogService } from '@/services/heterogeneousAgent';
import {
  heteroModelCatalogKey,
  type HeteroModelCatalogParams,
  heteroModelCatalogResource,
} from '@/store/device/heteroModelCatalog/projection';
import {
  initialHeteroModelCatalogState,
  useHeteroModelCatalogStore,
} from '@/store/device/heteroModelCatalog/store';

import { useModelCatalog } from './useModelCatalog';

const MutateBridge = () => {
  const { mutate } = useSWRConfig();
  useEffect(() => setScopedMutate(mutate), [mutate]);
  return null;
};

const createWrapper = (cache = new Map()) => {
  const value = { provider: () => cache };

  return function SWRTestWrapper({ children }: PropsWithChildren) {
    return createElement(SWRConfig, { value }, createElement(MutateBridge), children);
  };
};

/** Never-resolving discovery: the first frame can only come from storage. */
const pendingDiscovery = () =>
  new Promise<Awaited<ReturnType<typeof heterogeneousAgentCatalogService.listModels>>>(() => {});

let scope = '';
const seeded: HeteroModelCatalogParams[] = [];

const seed = (params: HeteroModelCatalogParams, models: { id: string; modelId: string }[]) => {
  seeded.push(params);
  return heteroModelCatalogResource.storage!.set(
    { queryKey: heteroModelCatalogResource.storageKey(params), scope },
    {
      data: {
        models: models.map((model) => ({ ...model, providerId: params.type })),
        status: 'success',
        updatedAt: 1,
      },
      updatedAt: 1,
    },
  );
};

beforeEach(() => {
  scope = `catalog-user-${randomUUID()}:personal`;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  act(() => useHeteroModelCatalogStore.setState(initialHeteroModelCatalogState));
});

afterEach(async () => {
  await Promise.all(
    seeded.splice(0).map((params) =>
      heteroModelCatalogResource.storage!.remove({
        queryKey: heteroModelCatalogResource.storageKey(params),
        scope,
      }),
    ),
  );
});

describe('useModelCatalog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Regression: the catalog lived only in SWR's memory cache, so after a reload
  // the selector stayed empty until the CLI discovery (seconds) answered.
  it('paints the persisted catalog of this device + agent before discovery answers', async () => {
    const params = {
      cwd: '/repo',
      deviceId: 'device-1',
      provider: { type: 'codex' },
      type: 'codex',
    } as const;
    await seed(params, [{ id: 'gpt-cached', modelId: 'gpt-cached' }]);
    const listModels = vi
      .spyOn(heterogeneousAgentCatalogService, 'listModels')
      .mockImplementation(pendingDiscovery);

    const { result } = renderHook(
      () =>
        useModelCatalog({
          ...params,
          isDeviceListLoading: false,
          isPreferenceLoading: false,
          open: false,
          targetReady: true,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.data?.models[0]?.id).toBe('gpt-cached'));
    // Something to paint: no loading row while discovery confirms in the background.
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isValidating).toBe(true);
    expect(listModels).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/repo', deviceId: 'device-1', type: 'codex' }),
    );
  });

  it('never paints another device or agent type from storage', async () => {
    await seed({ deviceId: 'device-2', provider: { type: 'codex' }, type: 'codex' }, [
      { id: 'other-device', modelId: 'other-device' },
    ]);
    await seed({ deviceId: 'device-1', provider: { type: 'opencode' }, type: 'opencode' }, [
      { id: 'other-agent', modelId: 'other-agent' },
    ]);
    vi.spyOn(heterogeneousAgentCatalogService, 'listModels').mockImplementation(pendingDiscovery);

    const { result } = renderHook(
      () =>
        useModelCatalog({
          deviceId: 'device-1',
          isDeviceListLoading: false,
          isPreferenceLoading: false,
          open: false,
          provider: { type: 'codex' },
          targetReady: true,
          type: 'codex',
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() =>
      expect(useHeteroModelCatalogStore.getState().heteroModelCatalogReplica).toBeDefined(),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });

  it('persists a confirmed catalog under a key that holds no provider env values', async () => {
    const params = {
      deviceId: 'device-1',
      provider: { env: { OPENAI_API_KEY: 'sk-secret' }, type: 'codex' },
      type: 'codex',
    } as const;
    seeded.push(params);
    const catalog = {
      models: [{ id: 'gpt-live', modelId: 'gpt-live', providerId: 'codex' }],
      status: 'success' as const,
      updatedAt: 3,
    };
    vi.spyOn(heterogeneousAgentCatalogService, 'listModels').mockResolvedValue(catalog);

    const { result } = renderHook(
      () =>
        useModelCatalog({
          ...params,
          isDeviceListLoading: false,
          isPreferenceLoading: false,
          open: false,
          targetReady: true,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.data).toEqual(catalog));
    const key = heteroModelCatalogKey(params);
    expect(key).not.toContain('sk-secret');
    await waitFor(async () =>
      expect(
        (
          await heteroModelCatalogResource.storage!.get({
            queryKey: heteroModelCatalogResource.storageKey(params),
            scope,
          })
        )?.data,
      ).toEqual(catalog),
    );
  });

  // Regression (Codex P2): the default sync key serialized the whole params,
  // so picking a model (`provider.model`) started another CLI discovery, and
  // raw `provider.env` values became part of an SWR cache key.
  it('keeps one discovery when only the selected model changes', async () => {
    const listModels = vi.spyOn(heterogeneousAgentCatalogService, 'listModels').mockResolvedValue({
      models: [{ id: 'gpt-live', modelId: 'gpt-live', providerId: 'codex' }],
      status: 'success',
      updatedAt: 1,
    });

    const { result, rerender } = renderHook(
      ({ model }: { model: string }) =>
        useModelCatalog({
          deviceId: 'device-1',
          isDeviceListLoading: false,
          isPreferenceLoading: false,
          open: false,
          provider: { env: { OPENAI_API_KEY: 'sk-secret' }, model, type: 'codex' },
          targetReady: true,
          type: 'codex',
        }),
      { initialProps: { model: 'gpt-a' }, wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.data?.models[0]?.id).toBe('gpt-live'));
    rerender({ model: 'gpt-b' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(listModels).toHaveBeenCalledTimes(1);
    expect(result.current.data?.models[0]?.id).toBe('gpt-live');
  });

  it('rediscovers when the launch config changes', async () => {
    const listModels = vi.spyOn(heterogeneousAgentCatalogService, 'listModels').mockResolvedValue({
      models: [],
      status: 'success',
      updatedAt: 1,
    });

    const { rerender } = renderHook(
      ({ token }: { token: string }) =>
        useModelCatalog({
          isDeviceListLoading: false,
          isPreferenceLoading: false,
          open: false,
          provider: { env: { OPENAI_API_KEY: token }, type: 'codex' },
          targetReady: true,
          type: 'codex',
        }),
      { initialProps: { token: 'sk-a' }, wrapper: createWrapper() },
    );

    await waitFor(() => expect(listModels).toHaveBeenCalledTimes(1));
    rerender({ token: 'sk-b' });
    await waitFor(() => expect(listModels).toHaveBeenCalledTimes(2));
    expect(listModels).toHaveBeenLastCalledWith(
      expect.objectContaining({ env: { OPENAI_API_KEY: 'sk-b' } }),
    );
  });

  it('keeps provider env values and unrelated config out of the SWR cache keys', async () => {
    const cache = new Map();
    vi.spyOn(heterogeneousAgentCatalogService, 'listModels').mockResolvedValue({
      models: [],
      status: 'success',
      updatedAt: 1,
    });

    const { result } = renderHook(
      () =>
        useModelCatalog({
          isDeviceListLoading: false,
          isPreferenceLoading: false,
          open: false,
          provider: {
            env: { OPENAI_API_KEY: 'sk-secret' },
            platformAgentId: 'agent: secret-context',
            type: 'codex',
          },
          targetReady: true,
          type: 'codex',
        }),
      { wrapper: createWrapper(cache) },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    const keys = [...cache.keys()].map(String).join('\n');
    expect(keys).toContain('heteroAgentModelCatalog');
    expect(keys).not.toContain('sk-secret');
    expect(keys).not.toContain('secret-context');
  });

  it.each([
    'codebuddy',
    'codex',
    'cursor',
    'droid',
    'grok-build',
    'opencode',
    'pi',
    'qoder',
    'trae',
  ] as const)('starts loading the %s catalog as soon as the selector mounts', async (type) => {
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
  });

  it('passes TRAE ACP provider arguments to model discovery', async () => {
    const listModels = vi.spyOn(heterogeneousAgentCatalogService, 'listModels').mockResolvedValue({
      models: [],
      status: 'success',
      updatedAt: 1,
    });

    renderHook(
      () =>
        useModelCatalog({
          isDeviceListLoading: false,
          isPreferenceLoading: false,
          open: false,
          provider: { args: ['--feature=test'], type: 'trae' },
          targetReady: true,
          type: 'trae',
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() =>
      expect(listModels).toHaveBeenCalledWith(
        expect.objectContaining({ args: ['--feature=test'], type: 'trae' }),
      ),
    );
  });

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

  it('retains the Codex catalog when a refresh fails', async () => {
    const loadedCatalog = {
      models: [{ id: 'future-model', modelId: 'future-model', providerId: 'codex' }],
      status: 'success' as const,
      updatedAt: 1,
    };
    vi.spyOn(heterogeneousAgentCatalogService, 'listModels')
      .mockResolvedValueOnce(loadedCatalog)
      .mockResolvedValueOnce({
        error: { code: 'timeout', message: 'Discovery timed out' },
        status: 'error',
        updatedAt: 2,
      });
    const { result } = renderHook(
      () =>
        useModelCatalog({
          isDeviceListLoading: false,
          isPreferenceLoading: false,
          open: false,
          provider: { type: 'codex' },
          targetReady: true,
          type: 'codex',
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.data).toEqual(loadedCatalog));
    await act(async () => {
      await result.current.mutate().catch(() => {});
    });
    expect(result.current.error?.name).toBe('timeout');
    expect(result.current.data).toEqual(loadedCatalog);
  });
});
