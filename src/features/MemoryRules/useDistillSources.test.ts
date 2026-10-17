import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useRecentPages, useTopics } from './useDistillSources';

const { getRecentPages, getRecentTopics, searchTopics } = vi.hoisted(() => ({
  getRecentPages: vi.fn(),
  getRecentTopics: vi.fn(),
  searchTopics: vi.fn(),
}));
vi.mock('@/services/file', () => ({ fileService: { getRecentPages } }));
vi.mock('@/services/topic', () => ({ topicService: { getRecentTopics, searchTopics } }));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => undefined,
}));

// A fresh cache per test, and no automatic retry, so a failure is observed as it happens.
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    SWRConfig,
    { value: { provider: () => new Map(), shouldRetryOnError: false } },
    children,
  );

describe('useDistillSources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports a failed document read as an error, not as no documents, and retries it', async () => {
    getRecentPages.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useRecentPages(true), { wrapper });

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.items).toBeUndefined();

    getRecentPages.mockResolvedValueOnce([{ id: 'doc-1', name: 'Spec', updatedAt: '2026-10-01' }]);
    await act(async () => {
      result.current.retry();
    });

    await waitFor(() =>
      expect(result.current.items).toEqual([
        { id: 'doc-1', name: 'Spec', updatedAt: '2026-10-01' },
      ]),
    );
    expect(result.current.error).toBe(false);
  });

  it('reports a failed conversation read as an error, not as no conversations', async () => {
    getRecentTopics.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useTopics(true, ''), { wrapper });

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.items).toBeUndefined();
  });

  it('does not read anything while its tab is closed', () => {
    renderHook(() => useRecentPages(false), { wrapper });
    expect(getRecentPages).not.toHaveBeenCalled();
  });
});
