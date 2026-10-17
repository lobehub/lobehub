import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sandboxStorageService } from '@/services/sandboxStorage';

import { useWorkspaceUsage } from './useEnvironmentData';
import { useEnvironmentRefresh } from './useEnvironmentRefresh';

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => undefined,
}));
vi.mock('@/services/sandboxStorage', () => ({
  sandboxStorageService: { getStorage: vi.fn(), refreshStorageUsage: vi.fn() },
}));

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(
    SWRConfig,
    { value: { provider: () => new Map(), shouldRetryOnError: false } },
    children,
  );
const resolved = async () => undefined;
const useRefreshUsage = () => {
  const usage = useWorkspaceUsage();
  const manual = useEnvironmentRefresh({
    environments: resolved,
    instances: resolved,
    usage: usage.refresh,
  });
  return { usage, manual };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('storage refresh through real SWR', () => {
  it('preserves cached bytes on measurement failure and clears the manual error after retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = { quotaBytes: 1000, usageBytes: 200, usageCheckedAt: null };
    vi.mocked(sandboxStorageService.getStorage).mockResolvedValue(original);
    vi.mocked(sandboxStorageService.refreshStorageUsage).mockRejectedValueOnce(new Error('503'));
    const { result } = renderHook(useRefreshUsage, { wrapper });
    await waitFor(() => expect(result.current.usage.data).toEqual(original));
    await act(async () => {
      await result.current.manual.refresh();
    });
    expect(result.current.manual.usageError).toBe(true);
    expect(result.current.usage.data).toEqual(original);
    vi.mocked(sandboxStorageService.refreshStorageUsage).mockResolvedValue({
      ...original,
      usageBytes: 300,
    });
    await act(async () => {
      await result.current.manual.refresh();
    });
    expect(result.current.manual.usageError).toBe(false);
    expect(result.current.usage.data?.usageBytes).toBe(300);
  });

  it('keeps an initial read error distinguishable from a successful null entitlement response', async () => {
    vi.mocked(sandboxStorageService.getStorage).mockRejectedValueOnce(new Error('read failed'));
    const first = renderHook(useRefreshUsage, { wrapper });
    await waitFor(() => expect(first.result.current.usage.error).toBeDefined());
    expect(first.result.current.usage.data).toBeUndefined();
    first.unmount();
    vi.mocked(sandboxStorageService.getStorage).mockResolvedValue(null);
    const second = renderHook(useRefreshUsage, { wrapper });
    await waitFor(() => expect(second.result.current.usage.data).toBeNull());
    expect(second.result.current.usage.error).toBeUndefined();
  });
});
