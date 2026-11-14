/**
 * Writes on the expertise replicas land on the local copy and its persisted
 * row, not only on a best-effort refetch: a retired habit or deleted direction
 * stays gone after a reload, and a failed write rolls back. Each "reload"
 * re-imports every module over the same IndexedDB.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({
  deleteDomain: vi.fn(),
  getDomain: vi.fn(),
  listByAgent: vi.fn(),
  listRules: vi.fn(),
  retireLesson: vi.fn(),
  updateRule: vi.fn(),
}));
const scope = vi.hoisted(() => ({ current: 'u1:personal' }));

vi.mock('@/services/expertise', () => ({ expertiseService: services }));
vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => scope.current,
  isScopeTrusted: () => true,
  useCacheScope: () => scope.current,
}));

const never = () => new Promise<never>(() => {});
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { dedupingInterval: 0, provider: () => new Map() } }, children);

const portrait = () => ({
  domains: [
    {
      id: 'd1',
      lessons: [
        { id: 'l1', title: 'Keep' },
        { id: 'l2', title: 'Retire me' },
      ],
      runCount: 3,
      title: 'Review',
    },
    { id: 'd2', lessons: [], runCount: 0, title: 'Drop me' },
  ],
});

const sheet = () => ({
  backlogRounds: 0,
  groups: [
    {
      domain: { id: 'g1' },
      rules: [{ direction: 'positive', enforcement: 'soft', id: 'r1', status: 'active' }],
    },
  ],
});

const boot = async () => {
  vi.resetModules();
  const store = await import('./index');
  return store;
};

/** Mount the portrait sync, wait for it, and return the store module. */
const loadPortrait = async () => {
  const store = await boot();
  const view = renderHook(() => store.expertiseActions.useFetchOverview('agent-1'), { wrapper });
  await waitFor(() =>
    expect(store.useExpertiseStore.getState().overviewMap['agent-1']).toBeDefined(),
  );
  return { store, view };
};

const lessonIds = (store: Awaited<ReturnType<typeof boot>>) =>
  store.useExpertiseStore
    .getState()
    .overviewMap['agent-1']?.domains.flatMap((d) => d.lessons.map((l) => l.id));

let run = 0;

beforeEach(() => {
  scope.current = `expertise-${++run}:personal`;
  for (const fn of Object.values(services)) fn.mockReset();
});

describe('retireLesson', () => {
  it('drops the habit from the portrait and from its persisted copy', async () => {
    services.listByAgent.mockResolvedValueOnce(portrait());
    const { store, view } = await loadPortrait();

    services.retireLesson.mockResolvedValue(undefined);
    // The server's answer after the write no longer lists the habit.
    const after = portrait();
    after.domains[0].lessons = [after.domains[0].lessons[0]];
    services.listByAgent.mockResolvedValue(after);
    await act(() => store.expertiseActions.retireLesson('agent-1', 'l2'));
    expect(lessonIds(store)).toEqual(['l1']);
    // Let the persisted write land before the "reload".
    await settle();
    view.unmount();

    // Reload offline: the retired habit must not come back from the local copy.
    services.listByAgent.mockImplementation(never);
    const reloaded = await boot();
    renderHook(() => reloaded.expertiseActions.useFetchOverview('agent-1'), { wrapper });
    await waitFor(() =>
      expect(reloaded.useExpertiseStore.getState().overviewMap['agent-1']).toBeDefined(),
    );
    expect(lessonIds(reloaded)).toEqual(['l1']);
  });

  it('puts the habit back when the call fails', async () => {
    services.listByAgent.mockResolvedValueOnce(portrait());
    const { store } = await loadPortrait();

    services.retireLesson.mockRejectedValue(new Error('500'));
    services.listByAgent.mockImplementation(never);
    await act(async () => {
      await expect(store.expertiseActions.retireLesson('agent-1', 'l2')).rejects.toThrow('500');
    });

    expect(lessonIds(store)).toEqual(['l1', 'l2']);
  });
});

describe('deleteDomain', () => {
  it('drops the direction and its detail entry, persisted', async () => {
    services.listByAgent.mockResolvedValueOnce(portrait());
    services.getDomain.mockResolvedValueOnce({ domain: { id: 'd2', title: 'Drop me' } });
    const { store, view } = await loadPortrait();
    const detail = renderHook(() => store.expertiseActions.useFetchDomain('d2'), { wrapper });
    await waitFor(() => expect(store.useExpertiseStore.getState().domainMap.d2).toBeDefined());
    detail.unmount();

    services.deleteDomain.mockResolvedValue(undefined);
    services.listByAgent.mockImplementation(never);
    await act(async () => {
      void store.expertiseActions.deleteDomain('agent-1', 'd2');
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(
      store.useExpertiseStore.getState().overviewMap['agent-1']?.domains.map((d) => d.id),
    ).toEqual(['d1']);
    expect(store.useExpertiseStore.getState().domainMap.d2).toBeUndefined();
    view.unmount();

    services.getDomain.mockImplementation(never);
    const reloaded = await boot();
    renderHook(
      () => {
        reloaded.expertiseActions.useFetchOverview('agent-1');
        reloaded.expertiseActions.useFetchDomain('d2');
      },
      { wrapper },
    );
    await waitFor(() =>
      expect(reloaded.useExpertiseStore.getState().overviewMap['agent-1']).toBeDefined(),
    );
    await settle();
    expect(
      reloaded.useExpertiseStore.getState().overviewMap['agent-1']?.domains.map((d) => d.id),
    ).toEqual(['d1']);
    expect(reloaded.useExpertiseStore.getState().domainMap.d2).toBeUndefined();
  });
});

describe('patchRules', () => {
  it('shows the switch at once and rolls it back when the save fails', async () => {
    services.listRules.mockResolvedValueOnce(sheet());
    const store = await boot();
    renderHook(() => store.expertiseActions.useFetchRules(), { wrapper });
    await waitFor(() =>
      expect(store.expertiseSelectors.rules(store.useExpertiseStore.getState())).toBeDefined(),
    );

    const enforcement = () =>
      store.expertiseSelectors.rules(store.useExpertiseStore.getState())?.groups[0].rules[0]
        .enforcement;
    let fail!: (error: unknown) => void;
    services.updateRule.mockImplementation(() => new Promise((_, reject) => (fail = reject)));

    let pending!: Promise<unknown>;
    act(() => {
      pending = store.expertiseActions.patchRules(
        (data) => ({
          ...data,
          groups: data.groups.map((g) => ({
            ...g,
            rules: g.rules.map((r) => ({ ...r, enforcement: 'hard' as never })),
          })),
        }),
        () => services.updateRule('r1', { enforcement: 'hard' }),
      );
    });
    expect(enforcement()).toBe('hard');

    await act(async () => {
      fail(new Error('500'));
      await expect(pending).rejects.toThrow('500');
    });
    expect(enforcement()).toBe('soft');
  });
});

describe('reset', () => {
  it("clears every sheet so the next identity never sees the previous one's", async () => {
    services.listByAgent.mockResolvedValueOnce(portrait());
    const { store } = await loadPortrait();

    act(() => store.expertiseActions.reset());

    expect(store.useExpertiseStore.getState().overviewMap).toEqual({});
  });
});
