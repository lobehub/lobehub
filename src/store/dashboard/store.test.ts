import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate } from '@/libs/swr';
import { dashboardService } from '@/services/dashboard';

import { useDashboardStore } from './index';
import { dashboardLevelKey, initialState } from './initialState';
import { widgetTrendSource } from './projection';

vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn(),
}));
vi.mock('@/services/dashboard', () => ({
  dashboardService: {
    addItem: vi.fn(),
    create: vi.fn(),
    getPreviewRun: vi.fn(),
    publish: vi.fn(),
    removeItems: vi.fn(),
    rename: vi.fn(),
    runWidget: vi.fn(),
    trash: vi.fn(),
    updateItemLayouts: vi.fn(),
  },
}));

const widget = (patch: Record<string, unknown> = {}) =>
  ({ id: 'w1', latestOutput: null, metricId: null, ...patch }) as any;

const board = (patch: Record<string, unknown> = {}) =>
  ({ id: 'd1', projectId: null, title: 'Ops', userId: 'u1', ...patch }) as any;

const detail = {
  id: 'd1',
  projectId: null,
  title: 'Ops',
  userId: 'u1',
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
        widget({ latestOutput: { series: [{ name: 'a' }, { name: 'b' }], type: 'series' } }),
      ),
    ).toBe('series:a\u0000b');
  });

  it('has no trend for list / table outputs', () => {
    expect(
      widgetTrendSource(widget({ latestOutput: { items: [], type: 'list' }, metricId: 'm1' })),
    ).toBeUndefined();
  });

  it('has no stat trend without a metric', () => {
    expect(widgetTrendSource(widget({ latestOutput: { type: 'stat', value: 1 } }))).toBeUndefined();
  });
});

describe('board entity propagation', () => {
  it('renames the board in every loaded projection at once', async () => {
    useDashboardStore.setState({
      dashboardDetailMap: { d1: detail },
      dashboardListByLevel: { personal: [board()] },
      projectDashboardsMap: { p1: [board({ projectId: 'p1' })] },
    });
    vi.mocked(dashboardService.rename).mockResolvedValue(undefined as any);

    await useDashboardStore.getState().renameDashboard('d1', 'Renamed', {});

    const state = useDashboardStore.getState();
    expect(state.dashboardDetailMap.d1.title).toBe('Renamed');
    // The detail's `items` survive the board patch.
    expect(state.dashboardDetailMap.d1.items).toHaveLength(2);
    expect(state.dashboardListByLevel.personal[0].title).toBe('Renamed');
    expect(state.projectDashboardsMap.p1[0].title).toBe('Renamed');
  });

  it('drops the board from the loaded lists when trashed', async () => {
    useDashboardStore.setState({
      dashboardDetailMap: { d1: detail },
      dashboardListByLevel: { personal: [board()] },
    });
    vi.mocked(dashboardService.trash).mockResolvedValue(undefined as any);

    await useDashboardStore.getState().trashDashboard('d1', {});

    const state = useDashboardStore.getState();
    expect(state.dashboardListByLevel.personal).toEqual([]);
    expect(state.dashboardDetailMap.d1).toBeUndefined();
  });
});

describe('createDashboard', () => {
  it('creates the board and revalidates the level it was created on', async () => {
    vi.mocked(dashboardService.create).mockResolvedValue(board() as any);

    await useDashboardStore.getState().createDashboard({ title: 'Ops' });

    expect(dashboardService.create).toHaveBeenCalledWith({ title: 'Ops' });
    expect(mutate).toHaveBeenCalled();
    expect(useDashboardStore.getState().dashboardCreating).toBe(false);
  });

  it('clears the creating flag when the server refuses', async () => {
    vi.mocked(dashboardService.create).mockRejectedValue(new Error('nope'));

    await expect(useDashboardStore.getState().createDashboard({ title: 'Ops' })).rejects.toThrow(
      'nope',
    );
    expect(useDashboardStore.getState().dashboardCreating).toBe(false);
  });
});

describe('saveDashboardLayout', () => {
  it('renders the new cells before the server confirms', async () => {
    useDashboardStore.setState({ dashboardDetailMap: { d1: detail } });
    let resolveSave: () => void = () => {};
    vi.mocked(dashboardService.updateItemLayouts).mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSave = () => resolve();
      }) as any,
    );

    const pending = useDashboardStore
      .getState()
      .saveDashboardLayout('d1', { i1: { h: 4, w: 4, x: 0, y: 0 } }, ['i2', 'i1']);

    // Optimistic: the dragged layout is on screen while the write is in flight.
    const optimistic = useDashboardStore.getState().dashboardDetailMap.d1;
    expect(optimistic.items[0].item.id).toBe('i2');
    expect(optimistic.items[1].item.layout).toEqual({ h: 4, w: 4, x: 0, y: 0 });
    expect(useDashboardStore.getState().dashboardLayoutSavingIds).toEqual(['d1']);

    resolveSave();
    await pending;
    expect(useDashboardStore.getState().dashboardLayoutSavingIds).toEqual([]);
  });

  it('revalidates the board when the save is refused', async () => {
    useDashboardStore.setState({ dashboardDetailMap: { d1: detail } });
    vi.mocked(dashboardService.updateItemLayouts).mockRejectedValue(new Error('read only'));

    await expect(
      useDashboardStore.getState().saveDashboardLayout('d1', { i1: null as any }, ['i1']),
    ).rejects.toThrow('read only');
    expect(mutate).toHaveBeenCalled();
    expect(useDashboardStore.getState().dashboardLayoutSavingIds).toEqual([]);
  });
});

describe('runWidget', () => {
  it('flags the widget while the run is in flight and refreshes it after', async () => {
    let resolveRun: (value: unknown) => void = () => {};
    vi.mocked(dashboardService.runWidget).mockReturnValue(
      new Promise((resolve) => {
        resolveRun = resolve;
      }) as any,
    );

    const pending = useDashboardStore.getState().runWidget('w1');
    expect(useDashboardStore.getState().widgetRunningIds).toEqual(['w1']);

    resolveRun({ id: 'r1', status: 'succeeded' });
    await pending;

    expect(useDashboardStore.getState().widgetRunningIds).toEqual([]);
    // Every surface showing the widget is revalidated, succeeded or not.
    expect(mutate).toHaveBeenCalled();
  });

  it('still refreshes when the run itself fails', async () => {
    vi.mocked(dashboardService.runWidget).mockRejectedValue(new Error('sandbox down'));

    await expect(useDashboardStore.getState().runWidget('w1')).rejects.toThrow('sandbox down');
    expect(useDashboardStore.getState().widgetRunningIds).toEqual([]);
    expect(mutate).toHaveBeenCalled();
  });
});

describe('publishWidgetVersion', () => {
  it('publishes, revalidates the versions and runs the widget once', async () => {
    vi.mocked(dashboardService.publish).mockResolvedValue({ version: { version: 4 } } as any);
    vi.mocked(dashboardService.runWidget).mockResolvedValue({ id: 'r1' } as any);

    await useDashboardStore.getState().publishWidgetVersion('w1', 'v4');

    expect(dashboardService.publish).toHaveBeenCalledWith('w1', 'v4');
    expect(dashboardService.runWidget).toHaveBeenCalledWith('w1');
    expect(useDashboardStore.getState().widgetPublishingIds).toEqual([]);
  });

  it('keeps the publish when the first run fails', async () => {
    vi.mocked(dashboardService.publish).mockResolvedValue({ version: { version: 4 } } as any);
    vi.mocked(dashboardService.runWidget).mockRejectedValue(new Error('sandbox down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(useDashboardStore.getState().publishWidgetVersion('w1', 'v4')).resolves.toEqual({
      version: { version: 4 },
    });

    expect(useDashboardStore.getState().widgetPublishingIds).toEqual([]);
    consoleError.mockRestore();
  });
});

describe('addWidgetToDashboard', () => {
  it('places the widget and revalidates the board and the widget', async () => {
    vi.mocked(dashboardService.addItem).mockResolvedValue({ id: 'i1' } as any);

    await useDashboardStore.getState().addWidgetToDashboard('d1', 'w1');

    expect(dashboardService.addItem).toHaveBeenCalledWith('d1', 'w1');
    expect(mutate).toHaveBeenCalled();
    expect(useDashboardStore.getState().widgetAddingIds).toEqual([]);
  });
});

describe('refreshWidgetPlacement', () => {
  it('revalidates the widget, the board and every board list', async () => {
    await useDashboardStore.getState().refreshWidgetPlacement('w1', 'd1');

    // One revalidate per affected resource: widget detail, board detail, both
    // board lists and the project widget list.
    expect(vi.mocked(mutate).mock.calls.length).toBeGreaterThanOrEqual(5);
  });
});
