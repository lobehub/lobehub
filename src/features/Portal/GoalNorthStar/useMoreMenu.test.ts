import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGoalNorthStarMoreMenu } from './useMoreMenu';

const mocks = vi.hoisted(() => ({
  canEdit: true,
  confirmModal: vi.fn(),
  metrics: [{ key: 'latency_ms', op: 'lte', target: 16.7, title: 'Input latency' }] as unknown[],
  removeGoalMetric: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: mocks.confirmModal,
  toast: { error: mocks.toastError },
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: mocks.canEdit }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatPortalSelectors: {
    goalNorthStarView: () => ({ goalId: 'goal_1', metricKey: 'latency_ms' }),
  },
}));

vi.mock('@/store/goal', () => ({
  goalSelectors: {
    goalGraph: () => () => ({ goal: { config: { acceptance: { metrics: mocks.metrics } } } }),
  },
  useGoalStore: (selector: (s: unknown) => unknown) =>
    selector({
      refreshGoalGraph: vi.fn(),
      refreshGoalMetricSeries: vi.fn(),
      removeGoalMetric: mocks.removeGoalMetric,
    }),
}));

const removeItem = (config: ReturnType<typeof useGoalNorthStarMoreMenu>) =>
  config?.extraItems?.find((item) => item && 'key' in item && item.key === 'remove') as
    { danger?: boolean; label?: unknown; onClick: () => void } | undefined;

describe('useGoalNorthStarMoreMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canEdit = true;
  });

  it('removes a declared clause after confirmation', async () => {
    // A clause nobody could fill held a finished goal's acceptance forever:
    // the panel offered record and edit, but no way to drop it.
    const { result } = renderHook(() => useGoalNorthStarMoreMenu());
    const remove = removeItem(result.current);

    // Labeled as removing the clause, not the generic "Delete": the
    // observation history is kept.
    expect(result.current?.delete).toBeUndefined();
    expect(remove).toMatchObject({ danger: true, label: 'goalProcess.northStar.remove.title' });

    remove!.onClick();
    expect(mocks.confirmModal).toHaveBeenCalledTimes(1);
    expect(mocks.removeGoalMetric).not.toHaveBeenCalled();

    await mocks.confirmModal.mock.calls[0][0].onOk();
    expect(mocks.removeGoalMetric).toHaveBeenCalledWith('goal_1', 'latency_ms');
  });

  it('tells the person when removal fails instead of closing silently', async () => {
    mocks.removeGoalMetric.mockRejectedValueOnce(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useGoalNorthStarMoreMenu());

    removeItem(result.current)!.onClick();
    await mocks.confirmModal.mock.calls[0][0].onOk();

    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });

  it('offers no removal to a viewer who cannot edit', () => {
    mocks.canEdit = false;
    const { result } = renderHook(() => useGoalNorthStarMoreMenu());

    expect(removeItem(result.current)).toBeUndefined();
  });
});
