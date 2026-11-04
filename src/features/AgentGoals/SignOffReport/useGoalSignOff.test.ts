import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyService } from '@/services/verify';

import { useGoalSignOff } from './useGoalSignOff';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@lobehub/ui', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/services/verify', () => ({
  verifyService: { acceptDelivery: vi.fn(), rejectDelivery: vi.fn() },
}));

describe('useGoalSignOff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts the delivery, then closes the report and re-reads the lists', async () => {
    const onClose = vi.fn();
    const onDecided = vi.fn();
    const { result } = renderHook(() =>
      useGoalSignOff({ acceptanceId: 'acc-1', onClose, onDecided }),
    );

    await act(async () => {
      expect(await result.current.accept()).toBe(true);
    });

    expect(verifyService.acceptDelivery).toHaveBeenCalledWith('acc-1', undefined);
    expect(verifyService.rejectDelivery).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onDecided).toHaveBeenCalledOnce();
  });

  it('sends the delivery back with the feedback and dispatches the rework', async () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useGoalSignOff({ acceptanceId: 'acc-1', onClose }));

    await act(async () => {
      expect(await result.current.requestChanges('fix the chart')).toBe(true);
    });

    expect(verifyService.rejectDelivery).toHaveBeenCalledWith('acc-1', 'fix the chart', {
      dispatch: true,
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the report open when the sign-off fails', async () => {
    vi.mocked(verifyService.acceptDelivery).mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onClose = vi.fn();
    const onDecided = vi.fn();
    const { result } = renderHook(() =>
      useGoalSignOff({ acceptanceId: 'acc-1', onClose, onDecided }),
    );

    await act(async () => {
      expect(await result.current.accept()).toBe(false);
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(onDecided).not.toHaveBeenCalled();
    expect(result.current.pending).toBeUndefined();
  });
});
