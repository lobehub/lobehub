import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AcceptanceLevel } from './goalAcceptanceTree';
import type { GoalNodeView } from './goalGraphViewModel';
import { useAcceptanceSignOff } from './useAcceptanceSignOff';

const mocks = vi.hoisted(() => ({
  acceptDelivery: vi.fn(),
  confirmModal: vi.fn(),
  refreshGoalGraph: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  updateAcceptanceStatusBatch: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (!options) return key;
      return `${key}::${Object.entries(options)
        .map(([name, value]) => `${name}=${value}`)
        .join(',')}`;
    },
  }),
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  confirmModal: (...args: unknown[]) => mocks.confirmModal(...args),
  toast: {
    error: (...args: unknown[]) => mocks.toastError(...args),
    success: (...args: unknown[]) => mocks.toastSuccess(...args),
    warning: (...args: unknown[]) => mocks.toastWarning(...args),
  },
}));

vi.mock('@/services/verify', () => ({
  verifyService: {
    acceptDelivery: (...args: unknown[]) => mocks.acceptDelivery(...args),
    updateAcceptanceStatusBatch: (...args: unknown[]) => mocks.updateAcceptanceStatusBatch(...args),
  },
}));

vi.mock('@/store/goal', () => ({
  useGoalStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ refreshGoalGraph: mocks.refreshGoalGraph }),
}));

const level = (
  title: string,
  state: AcceptanceLevel['state'],
  extra: { acceptanceId?: string } = {},
): AcceptanceLevel =>
  ({
    ...(extra.acceptanceId ? { acceptanceId: extra.acceptanceId } : {}),
    key: title,
    node: { node: { id: title, title } } as unknown as GoalNodeView,
    state,
  }) as AcceptanceLevel;

const waiting = level('CF Sandbox', 'awaitingSignOff', { acceptanceId: 'acc-wait' });
const alsoWaiting = level('JSON contract', 'awaitingSignOff', { acceptanceId: 'acc-wait-2' });
const done = level('Tables', 'signedOff', { acceptanceId: 'acc-done' });
const running = level('Router', 'inProgress', { acceptanceId: 'acc-live' });
const unDispatched = level('Later', 'unavailable');

const sweepConfig = () => mocks.confirmModal.mock.calls[0][0] as { onOk: () => Promise<void> };

describe('useAcceptanceSignOff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acceptDelivery.mockResolvedValue(undefined);
    mocks.updateAcceptanceStatusBatch.mockResolvedValue({ failedIds: [], updated: 0 });
  });

  it('lists only the levels waiting on the owner', () => {
    const { result } = renderHook(() =>
      useAcceptanceSignOff('goal-1', [waiting, done, running, unDispatched, alsoWaiting]),
    );

    expect(result.current.awaiting).toEqual([waiting, alsoWaiting]);
  });

  it('signs off the level it is given and refreshes the graph', async () => {
    const { result } = renderHook(() => useAcceptanceSignOff('goal-1', [waiting]));

    await act(() => result.current.acceptLevel(waiting));

    expect(mocks.acceptDelivery).toHaveBeenCalledWith('acc-wait');
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('CF Sandbox') }),
    );
    expect(mocks.refreshGoalGraph).toHaveBeenCalledWith('goal-1');
    expect(result.current.pendingKey).toBeNull();
  });

  it('reports a failed sign-off and keeps the level as it was', async () => {
    mocks.acceptDelivery.mockRejectedValueOnce(new Error('nope'));
    const { result } = renderHook(() => useAcceptanceSignOff('goal-1', [waiting]));

    await act(() => result.current.acceptLevel(waiting));

    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith('goalProcess.acceptanceHierarchy.acceptError');
    expect(mocks.refreshGoalGraph).not.toHaveBeenCalled();
    expect(result.current.pendingKey).toBeNull();
  });

  it('sweeps every waiting level through the batch endpoint after a confirmation', async () => {
    mocks.updateAcceptanceStatusBatch.mockResolvedValue({ failedIds: [], updated: 2 });
    const { result } = renderHook(() =>
      useAcceptanceSignOff('goal-1', [waiting, done, alsoWaiting]),
    );

    act(() => result.current.acceptAll());
    expect(mocks.updateAcceptanceStatusBatch).not.toHaveBeenCalled();

    await act(() => sweepConfig().onOk());

    // Only the levels the owner can actually sign off — never a decided or live one.
    expect(mocks.updateAcceptanceStatusBatch).toHaveBeenCalledWith(
      ['acc-wait', 'acc-wait-2'],
      'accepted',
    );
    // A clean sweep reports once, on the success channel.
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('count=2') }),
    );
    expect(mocks.toastWarning).not.toHaveBeenCalled();
    expect(mocks.refreshGoalGraph).toHaveBeenCalledWith('goal-1');
  });

  it('reports a partial sweep in ONE toast, naming both halves', async () => {
    mocks.updateAcceptanceStatusBatch.mockResolvedValue({ failedIds: ['acc-wait'], updated: 1 });
    const { result } = renderHook(() => useAcceptanceSignOff('goal-1', [waiting, alsoWaiting]));

    act(() => result.current.acceptAll());
    await act(() => sweepConfig().onOk());

    // One action, one report: a single toast carries what landed AND what did not.
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1);
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining('accepted=1,failed=1'),
      }),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('never opens a sweep when nothing is waiting', () => {
    const { result } = renderHook(() => useAcceptanceSignOff('goal-1', [done, running]));

    act(() => result.current.acceptAll());

    expect(mocks.confirmModal).not.toHaveBeenCalled();
    expect(mocks.updateAcceptanceStatusBatch).not.toHaveBeenCalled();
  });

  it('keeps the other rows usable while one sign-off is in flight', async () => {
    let release = () => {};
    mocks.acceptDelivery.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() => useAcceptanceSignOff('goal-1', [waiting]));

    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.acceptLevel(waiting);
    });
    await waitFor(() => expect(result.current.pendingKey).toBe(waiting.key));

    await act(async () => {
      release();
      await pending;
    });
    expect(result.current.pendingKey).toBeNull();
  });
});
