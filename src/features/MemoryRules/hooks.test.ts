/**
 * My rules reads the reviewer's rule sheet and a rule's evidence / edits from
 * local replicas: a reload paints the last copy from IndexedDB before the
 * network answers, then the server's answer replaces it. Each test "reloads"
 * by re-importing every module (a fresh store, engine and SWR cache) over the
 * same IndexedDB.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
  listRules: vi.fn(),
  ruleRevisions: vi.fn(),
  ruleSources: vi.fn(),
}));
const scope = vi.hoisted(() => ({ current: 'u1:personal' }));

vi.mock('@/services/expertise', () => ({ expertiseService: services }));
vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => scope.current,
  isScopeTrusted: () => true,
  useCacheScope: () => scope.current,
}));

const never = () => new Promise<never>(() => {});

const sheet = (titles: string[]) => ({
  backlogRounds: 0,
  groups: [
    {
      domain: { id: 'd1', title: 'Review' },
      rules: titles.map((title, i) => ({ id: `r${i}`, status: 'active', title })),
    },
  ],
});

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

/** A fresh page: new store, replica engine and (empty) SWR cache. */
const boot = async () => {
  vi.resetModules();
  return import('./hooks');
};

let run = 0;

beforeEach(() => {
  // Each test owns its partition, so persisted rows never leak between tests.
  scope.current = `rules-${++run}:personal`;
  for (const fn of Object.values(services)) fn.mockReset();
});

describe('useRules', () => {
  it('paints the persisted rule sheet after a reload, before the network answers', async () => {
    services.listRules.mockResolvedValueOnce(sheet(['Cite the source']));
    const { useRules } = await boot();
    const warm = renderHook(() => useRules(), { wrapper });
    await waitFor(() => expect(warm.result.current.data?.groups[0].rules).toHaveLength(1));
    warm.unmount();

    // Reload: the server is slow to answer.
    services.listRules.mockImplementation(never);
    const { useRules: reloaded } = await boot();
    const { result } = renderHook(() => reloaded(), { wrapper });

    await waitFor(() =>
      expect(result.current.data?.groups[0].rules[0].title).toBe('Cite the source'),
    );
  });

  it('replaces the restored sheet with the server answer', async () => {
    services.listRules.mockResolvedValueOnce(sheet(['Old rule']));
    const { useRules } = await boot();
    const warm = renderHook(() => useRules(), { wrapper });
    await waitFor(() => expect(warm.result.current.data).toBeDefined());
    warm.unmount();

    let answer!: (value: unknown) => void;
    services.listRules.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const { useRules: reloaded } = await boot();
    const { result } = renderHook(() => reloaded(), { wrapper });
    await waitFor(() => expect(result.current.data?.groups[0].rules[0].title).toBe('Old rule'));

    await act(async () => answer(sheet(['New rule'])));
    await waitFor(() => expect(result.current.data?.groups[0].rules[0].title).toBe('New rule'));
  });

  it('treats a restored empty sheet as unconfirmed until the server answers', async () => {
    services.listRules.mockResolvedValueOnce({ backlogRounds: 0, groups: [] });
    const { useRules } = await boot();
    const warm = renderHook(() => useRules(), { wrapper });
    await waitFor(() => expect(warm.result.current.isConfirmed).toBe(true));
    warm.unmount();

    let answer!: (value: unknown) => void;
    services.listRules.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const { useRules: reloaded } = await boot();
    const { result } = renderHook(() => reloaded(), { wrapper });

    // The empty sheet is last session's: the page must not open on onboarding from it.
    await waitFor(() => expect(result.current.data?.groups).toEqual([]));
    expect(result.current.isConfirmed).toBe(false);

    await act(async () => answer({ backlogRounds: 0, groups: [] }));
    await waitFor(() => expect(result.current.isConfirmed).toBe(true));
  });

  it('keeps a restored empty sheet unsettled, so the page shows loading and then the error', async () => {
    services.listRules.mockResolvedValueOnce({ backlogRounds: 0, groups: [] });
    const { useRules } = await boot();
    const warm = renderHook(() => useRules(), { wrapper });
    await waitFor(() => expect(warm.result.current.isConfirmed).toBe(true));
    warm.unmount();

    let fail!: (error: unknown) => void;
    services.listRules.mockImplementation(() => new Promise((_, reject) => (fail = reject)));
    const { useRules: reloaded } = await boot();
    const { result } = renderHook(() => reloaded(), { wrapper });

    await waitFor(() => expect(result.current.data?.groups).toEqual([]));
    expect(result.current.settled).toBeUndefined();
    expect(result.current.isLoading).toBe(true);

    await act(async () => fail(new Error('offline')));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    // Nothing settled + an error: the boundary renders the error with Retry, not an empty sheet.
    expect(result.current.settled).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('keeps the restored sheet when the background refresh fails', async () => {
    services.listRules.mockResolvedValueOnce(sheet(['Kept rule']));
    const { useRules } = await boot();
    const warm = renderHook(() => useRules(), { wrapper });
    await waitFor(() => expect(warm.result.current.data).toBeDefined());
    warm.unmount();

    services.listRules.mockRejectedValue(new Error('offline'));
    const { useRules: reloaded } = await boot();
    const { result } = renderHook(() => reloaded(), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data?.groups[0].rules[0].title).toBe('Kept rule');
  });

  it("does not paint another identity's sheet", async () => {
    services.listRules.mockResolvedValueOnce(sheet(['Mine']));
    const { useRules } = await boot();
    const warm = renderHook(() => useRules(), { wrapper });
    await waitFor(() => expect(warm.result.current.data).toBeDefined());
    warm.unmount();

    // Someone else signs in on the same browser.
    scope.current = `${scope.current}-other`;
    services.listRules.mockImplementation(never);
    const { useRules: reloaded } = await boot();
    const { result } = renderHook(() => reloaded(), { wrapper });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(result.current.data).toBeUndefined();
  });
});

describe('useRuleSources', () => {
  it("paints a rule's persisted evidence after a reload, but not as a confirmed empty list", async () => {
    services.ruleSources.mockResolvedValueOnce([{ id: 's1', topicId: 't1' }]);
    services.ruleSources.mockResolvedValueOnce([]);
    const { useRuleSources } = await boot();
    const a = renderHook(() => useRuleSources('r1'), { wrapper });
    await waitFor(() => expect(a.result.current.data).toHaveLength(1));
    a.unmount();
    const b = renderHook(() => useRuleSources('r2'), { wrapper });
    await waitFor(() => expect(b.result.current.data).toEqual([]));
    b.unmount();

    services.ruleSources.mockImplementation(never);
    const { useRuleSources: reloaded } = await boot();
    const withSources = renderHook(() => reloaded('r1'), { wrapper });
    const withoutSources = renderHook(() => reloaded('r2'), { wrapper });

    await waitFor(() => expect(withSources.result.current.data).toHaveLength(1));
    await waitFor(() => expect(withoutSources.result.current.data).toEqual([]));
    // "No sources" would read as lost evidence: a restored empty list is still loading.
    expect(withoutSources.result.current.isLoading).toBe(true);
  });
});

describe('useRuleRevisions', () => {
  it("paints a rule's persisted edits after a reload", async () => {
    services.ruleRevisions.mockResolvedValueOnce([{ id: 'v1', prevTitle: 'Before' }]);
    const { useRuleRevisions } = await boot();
    const warm = renderHook(() => useRuleRevisions('r1'), { wrapper });
    await waitFor(() => expect(warm.result.current.data).toHaveLength(1));
    warm.unmount();

    services.ruleRevisions.mockImplementation(never);
    const { useRuleRevisions: reloaded } = await boot();
    const { result } = renderHook(() => reloaded('r1'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual([{ id: 'v1', prevTitle: 'Before' }]));
  });
});
