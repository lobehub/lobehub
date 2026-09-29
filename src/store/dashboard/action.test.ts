import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { dashboardService } from '@/services/dashboard';

import { widgetTrendSource } from './action';
import { useDashboardStore } from './index';
import { dashboardLevelKey, initialState } from './initialState';

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(),
}));
vi.mock('@/services/dashboard', () => ({
  dashboardService: {
    create: vi.fn(),
    runWidget: vi.fn(),
    updateItemLayouts: vi.fn(),
  },
}));

const widget = (patch: Record<string, unknown> = {}) =>
  ({ id: 'w1', latestOutput: null, metricId: null, ...patch }) as any;

const detail = {
  id: 'd1',
  items: [
    { item: { id: 'i1', layout: { h: 2, w: 3, x: 0, y: 0 }, sortOrder: 0 }, widget: widget() },
    {
      item: { id: 'i2', layout: null, sortOrder: 1 },
      widget: widget({ id: 'w2', lastRunStatus: 'running' }),
    },
  ],
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  useDashboardStore.setState(initialState);
});

describe('dashboardLevelKey', () => {
  it('names the personal level and scoped levels distinctly', () => {
    expect(dashboardLevelKey()).toBe('personal');
    expect(dashboardLevelKey({ projectId: 'p' })).toBe('project:p');
    expect(dashboardLevelKey({ agentId: 'a', projectId: 'p' })).toBe('project:p/agent:a');
  });
});

describe('widgetTrendSource', () => {
  it('reads a stat trend from its primary metric', () => {
    expect(
      widgetTrendSource(widget({ latestOutput: { type: 'stat', value: 1 }, metricId: 'm1' })),
    ).toBe('metric:m1');
  });

  it('reads a series trend from its per-series metrics', () => {
    expect(
      widgetTrendSource(
        widget({
          latestOutput: { series: [{ name: 'a', points: [] }], type: 'series' },
        }),
      ),
    ).toBe('series:a');
  });

  it('has no trend for list and table outputs', () => {
    expect(
      widgetTrendSource(widget({ latestOutput: { items: [], type: 'list' }, metricId: 'm1' })),
    ).toBeUndefined();
  });
});

describe('useFetchDashboardDetail', () => {
  it('polls while a widget on the board is running and stops once it settles', () => {
    useDashboardStore.getState().useFetchDashboardDetail('d1');
    const options = vi.mocked(useClientDataSWR).mock.calls.at(-1)?.[2] as {
      refreshInterval: (data?: unknown) => number;
    };
    expect(options.refreshInterval(detail)).toBeGreaterThan(0);
    expect(options.refreshInterval({ ...detail, items: [detail.items[0]] })).toBe(0);
    expect(options.refreshInterval(undefined)).toBe(0);
  });

  it('does not fetch without an id', () => {
    useDashboardStore.getState().useFetchDashboardDetail(undefined);
    expect(vi.mocked(useClientDataSWR).mock.calls.at(-1)?.[0]).toBeNull();
  });
});

describe('runWidget', () => {
  it('tracks the running id and refreshes the widget even when the run fails', async () => {
    let resolveRun: (value: unknown) => void = () => {};
    vi.mocked(dashboardService.runWidget).mockReturnValue(
      new Promise((resolve) => {
        resolveRun = resolve;
      }) as any,
    );

    const pending = useDashboardStore.getState().runWidget('w1');
    expect(useDashboardStore.getState().widgetRunningIds).toEqual(['w1']);

    resolveRun({ status: 'failed' });
    await expect(pending).resolves.toEqual({ status: 'failed' });

    expect(useDashboardStore.getState().widgetRunningIds).toEqual([]);
    // Every board detail, the run history and the trend revalidate.
    expect(mutate).toHaveBeenCalledWith(expect.any(Function));
    expect(mutate).toHaveBeenCalledWith(['dashboard:runs', 'w1']);
  });

  it('clears the running id when the request rejects', async () => {
    vi.mocked(dashboardService.runWidget).mockRejectedValue(new Error('boom'));
    await expect(useDashboardStore.getState().runWidget('w1')).rejects.toThrow('boom');
    expect(useDashboardStore.getState().widgetRunningIds).toEqual([]);
  });
});

describe('saveDashboardLayout', () => {
  it('applies the new cells right away and persists layout with sort order', async () => {
    useDashboardStore.setState({ dashboardDetailMap: { d1: detail } });
    vi.mocked(dashboardService.updateItemLayouts).mockResolvedValue({} as any);

    await useDashboardStore
      .getState()
      .saveDashboardLayout(
        'd1',
        { i1: { h: 2, w: 6, x: 6, y: 0 }, i2: { h: 4, w: 6, x: 0, y: 0 } },
        ['i2', 'i1'],
      );

    expect(dashboardService.updateItemLayouts).toHaveBeenCalledWith('d1', [
      { id: 'i1', layout: { h: 2, w: 6, x: 6, y: 0 }, sortOrder: 1 },
      { id: 'i2', layout: { h: 4, w: 6, x: 0, y: 0 }, sortOrder: 0 },
    ]);
    const items = useDashboardStore.getState().dashboardDetailMap.d1.items;
    expect(items.map(({ item }) => item.id)).toEqual(['i2', 'i1']);
    expect(items[1].item.layout).toEqual({ h: 2, w: 6, x: 6, y: 0 });
    expect(useDashboardStore.getState().dashboardLayoutSavingIds).toEqual([]);
  });

  it('revalidates the board when the save is rejected', async () => {
    useDashboardStore.setState({ dashboardDetailMap: { d1: detail } });
    vi.mocked(dashboardService.updateItemLayouts).mockRejectedValue(new Error('nope'));

    await expect(
      useDashboardStore
        .getState()
        .saveDashboardLayout('d1', { i1: { h: 2, w: 6, x: 0, y: 0 } }, ['i1', 'i2']),
    ).rejects.toThrow('nope');

    expect(mutate).toHaveBeenCalledWith(['dashboard:detail', 'd1']);
    expect(useDashboardStore.getState().dashboardLayoutSavingIds).toEqual([]);
  });
});

describe('createDashboard', () => {
  it('refreshes the level it created into and clears the pending flag', async () => {
    vi.mocked(dashboardService.create).mockResolvedValue({ id: 'd9' } as any);
    await expect(useDashboardStore.getState().createDashboard({ title: 'Ops' })).resolves.toEqual({
      id: 'd9',
    });
    expect(mutate).toHaveBeenCalledWith(['dashboard:list', 'personal']);
    expect(useDashboardStore.getState().dashboardCreating).toBe(false);
  });
});
