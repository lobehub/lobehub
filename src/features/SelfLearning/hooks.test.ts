/**
 * An agent's Self-evolving pages read its portrait, a direction, a lesson and
 * the warm-up count from local replicas: a reload paints the last copy from
 * IndexedDB before the network answers. Each test "reloads" by re-importing
 * every module (a fresh store, engine and SWR cache) over the same IndexedDB.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
  countHistory: vi.fn(),
  getDomain: vi.fn(),
  getLesson: vi.fn(),
  listByAgent: vi.fn(),
}));
const scope = vi.hoisted(() => ({ current: 'u1:personal' }));

vi.mock('@/services/expertise', () => ({ expertiseService: services }));
vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => scope.current,
  isScopeTrusted: () => true,
  useCacheScope: () => scope.current,
}));

const never = () => new Promise<never>(() => {});

const portrait = (titles: string[]) => ({
  domains: titles.map((title, i) => ({ id: `d${i}`, lessons: [], runCount: 0, title })),
});

const lesson = (title: string) => ({ hits: [], lesson: { code: 'L-01', sections: [], title } });

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

/** A fresh page: new store, replica engine and (empty) SWR cache. */
const boot = async () => {
  vi.resetModules();
  return import('./hooks');
};

let run = 0;

beforeEach(() => {
  scope.current = `self-learning-${++run}:personal`;
  for (const fn of Object.values(services)) fn.mockReset();
});

describe('useExpertiseOverview', () => {
  it("paints the agent's persisted portrait after a reload, then the server's", async () => {
    services.listByAgent.mockResolvedValueOnce(portrait(['Code review']));
    const { useExpertiseOverview } = await boot();
    const warm = renderHook(() => useExpertiseOverview('agent-1'), { wrapper });
    await waitFor(() => expect(warm.result.current.data?.domains).toHaveLength(1));
    warm.unmount();

    let answer!: (value: unknown) => void;
    services.listByAgent.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const { useExpertiseOverview: reloaded } = await boot();
    const { result } = renderHook(() => reloaded('agent-1'), { wrapper });

    await waitFor(() => expect(result.current.data?.domains[0].title).toBe('Code review'));

    await act(async () => answer(portrait(['Code review', 'Writing'])));
    await waitFor(() => expect(result.current.data?.domains).toHaveLength(2));
  });

  it('keeps each agent under its own entry', async () => {
    services.listByAgent.mockImplementation(async (agentId: string) => portrait([agentId]));
    const { useExpertiseOverview } = await boot();
    const { rerender, result } = renderHook(({ id }) => useExpertiseOverview(id), {
      initialProps: { id: 'agent-1' },
      wrapper,
    });
    await waitFor(() => expect(result.current.data?.domains[0].title).toBe('agent-1'));

    rerender({ id: 'agent-2' });
    await waitFor(() => expect(result.current.data?.domains[0].title).toBe('agent-2'));
  });

  it('treats a restored empty portrait as unconfirmed until the server answers', async () => {
    services.listByAgent.mockResolvedValueOnce({ domains: [] });
    const { useExpertiseOverview } = await boot();
    const warm = renderHook(() => useExpertiseOverview('agent-1'), { wrapper });
    await waitFor(() => expect(warm.result.current.isConfirmed).toBe(true));
    warm.unmount();

    services.listByAgent.mockImplementation(never);
    const { useExpertiseOverview: reloaded } = await boot();
    const { result } = renderHook(() => reloaded('agent-1'), { wrapper });

    await waitFor(() => expect(result.current.data?.domains).toEqual([]));
    expect(result.current.isConfirmed).toBe(false);
  });

  it('keeps the restored portrait when the background refresh fails', async () => {
    services.listByAgent.mockResolvedValueOnce(portrait(['Kept']));
    const { useExpertiseOverview } = await boot();
    const warm = renderHook(() => useExpertiseOverview('agent-1'), { wrapper });
    await waitFor(() => expect(warm.result.current.data).toBeDefined());
    warm.unmount();

    services.listByAgent.mockRejectedValue(new Error('offline'));
    const { useExpertiseOverview: reloaded } = await boot();
    const { result } = renderHook(() => reloaded('agent-1'), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data?.domains[0].title).toBe('Kept');
  });

  it('answers the page, the warm-up and the habit list with one request', async () => {
    services.listByAgent.mockResolvedValue(portrait(['One']));
    const { useExpertiseOverview } = await boot();

    // The portrait header, the warm-up poll and the experience list mount together.
    const { result } = renderHook(
      () => {
        useExpertiseOverview('agent-1');
        useExpertiseOverview('agent-1', 0);
        return useExpertiseOverview('agent-1');
      },
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(services.listByAgent).toHaveBeenCalledTimes(1);
  });
});

describe('useExpertiseLesson', () => {
  it('paints a persisted lesson after a reload, before the network answers', async () => {
    services.getLesson.mockResolvedValueOnce(lesson('Name the file'));
    const { useExpertiseLesson } = await boot();
    const warm = renderHook(() => useExpertiseLesson('l1'), { wrapper });
    await waitFor(() => expect(warm.result.current.data).toBeDefined());
    warm.unmount();

    services.getLesson.mockImplementation(never);
    const { useExpertiseLesson: reloaded } = await boot();
    const { result } = renderHook(() => reloaded('l1'), { wrapper });

    await waitFor(() => expect(result.current.data?.lesson.title).toBe('Name the file'));
  });

  it('says "not found" only once the server answers that the lesson is gone', async () => {
    let answer!: (value: unknown) => void;
    services.getLesson.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const { useExpertiseLesson } = await boot();
    const { result } = renderHook(() => useExpertiseLesson('gone'), { wrapper });

    await waitFor(() => expect(services.getLesson).toHaveBeenCalled());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.notFound).toBe(false);

    await act(async () => answer(null));
    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.isLoading).toBe(false);
  });

  it('drops a lesson the server says is gone from the local copy', async () => {
    services.getLesson.mockResolvedValueOnce(lesson('Retired'));
    const { useExpertiseLesson } = await boot();
    const warm = renderHook(() => useExpertiseLesson('l1'), { wrapper });
    await waitFor(() => expect(warm.result.current.data).toBeDefined());
    warm.unmount();

    services.getLesson.mockResolvedValueOnce(null);
    const { useExpertiseLesson: second } = await boot();
    const gone = renderHook(() => second('l1'), { wrapper });
    await waitFor(() => expect(gone.result.current.notFound).toBe(true));
    gone.unmount();

    services.getLesson.mockImplementation(never);
    const { useExpertiseLesson: third } = await boot();
    const { result } = renderHook(() => third('l1'), { wrapper });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(result.current.data).toBeUndefined();
  });
});

describe('useExpertiseDomain / useHistoryCount', () => {
  it('paint their persisted values after a reload', async () => {
    services.getDomain.mockResolvedValueOnce({ domain: { id: 'd1', title: 'Review' } });
    services.countHistory.mockResolvedValueOnce({ candidateCount: 7 });
    const { useExpertiseDomain, useHistoryCount } = await boot();
    const warm = renderHook(
      () => ({ count: useHistoryCount('agent-1'), domain: useExpertiseDomain('d1') }),
      { wrapper },
    );
    await waitFor(() => expect(warm.result.current.domain.data).toBeDefined());
    await waitFor(() => expect(warm.result.current.count.data).toBeDefined());
    warm.unmount();

    services.getDomain.mockImplementation(never);
    services.countHistory.mockImplementation(never);
    const reloaded = await boot();
    const { result } = renderHook(
      () => ({
        count: reloaded.useHistoryCount('agent-1'),
        domain: reloaded.useExpertiseDomain('d1'),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.domain.data?.domain.title).toBe('Review'));
    await waitFor(() => expect(result.current.count.data?.candidateCount).toBe(7));
  });
});
