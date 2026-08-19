import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    changelog: {
      getIndex: { query },
    },
  },
}));

const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

describe('useChangelogIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns changelog entries from the lambda API', async () => {
    query.mockResolvedValueOnce([{ id: 'local1', date: '2026-01-01', versionRange: ['1.0.0'] }]);

    const { useChangelogIndex } = await import('./useChangelogIndex');
    const { result } = renderHook(() => useChangelogIndex(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data?.[0]?.id).toBe('local1');
    expect(result.current.error).toBeUndefined();
  });

  it('surfaces a failed changelog fetch so the UI can retry', async () => {
    query.mockRejectedValueOnce(new Error('network down'));

    const { useChangelogIndex } = await import('./useChangelogIndex');
    const { result } = renderHook(() => useChangelogIndex(), { wrapper });

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });

    expect(result.current.data).toBeUndefined();
  });
});
