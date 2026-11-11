import type * as LobeUI from '@lobehub/ui';
import { toast } from '@lobehub/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UsageBreakdown } from './UsageBreakdown';

vi.mock('@/business/client/features/RetainedMemberDrives', () => ({ default: () => null }));
vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof LobeUI>();
  return {
    ...actual,
    // Real base-ui ActionIcon only surfaces its title via a hover Tooltip, so
    // a plain button stands in to make the refresh clickable by its label.
    ActionIcon: ({ onClick, title }: { onClick?: () => void; title?: string }) => (
      <button title={title} type="button" onClick={onClick} />
    ),
    toast: { ...actual.toast, error: vi.fn() },
    Tooltip: ({ children }: { children: unknown }) => children,
  };
});

const overQuota = (overageAllowed: boolean) =>
  ({
    drives: [{ drive: 'personal', usageBytes: 200, usageCheckedAt: null }],
    members: [],
    overageAllowed,
    quotaBytes: 100,
    totalUsageBytes: 200,
  }) as any;

describe('UsageBreakdown', () => {
  it('should say saves are refused over a quota the plan does not bill past', () => {
    render(<UsageBreakdown data={overQuota(false)} onRefresh={vi.fn()} />);

    expect(screen.getByText('drive.usage.over')).toBeInTheDocument();
    expect(screen.queryByText('drive.usage.overBilled')).not.toBeInTheDocument();
  });

  it('should say the overage is billed when the plan allows it', () => {
    // Pay-as-you-go keeps writes going; "free up space before saving" would
    // be untrue there.
    render(<UsageBreakdown data={overQuota(true)} onRefresh={vi.fn()} />);

    expect(screen.getByText('drive.usage.overBilled')).toBeInTheDocument();
    expect(screen.queryByText('drive.usage.over')).not.toBeInTheDocument();
  });

  // LOBE-15436: a refresh whose walk timed out used to answer with the old
  // figure as if it had been re-measured.
  it('should say the figure is the last measurement when the drive could not be measured', async () => {
    const onRefresh = vi.fn().mockRejectedValue(new Error('STORAGE_USAGE_MEASURE_FAILED'));
    render(<UsageBreakdown data={overQuota(false)} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByTitle('drive.usage.refresh'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('drive.usage.refreshFailed'));
  });

  it('should keep the generic message for any other refresh failure', async () => {
    const onRefresh = vi.fn().mockRejectedValue(new Error('BAD_GATEWAY'));
    render(<UsageBreakdown data={overQuota(false)} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByTitle('drive.usage.refresh'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('workingDirectory.drive.actionFailed'),
    );
  });

  // LOBE-15436: a drive too large to walk in one call is measured over several.
  describe('a drive measured over several calls', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    const advance = () => vi.advanceTimersByTimeAsync(3000);

    it('should keep measuring a large drive and show how much it has counted', async () => {
      const onRefresh = vi
        .fn()
        .mockResolvedValueOnce({ measuring: { drives: ['personal'], scannedBytes: 1024 } })
        .mockResolvedValueOnce({ measuring: { drives: ['personal'], scannedBytes: 2048 } })
        .mockResolvedValueOnce({});
      render(<UsageBreakdown data={overQuota(false)} onRefresh={onRefresh} />);

      fireEvent.click(screen.getByTitle('drive.usage.refresh'));

      await waitFor(() => expect(screen.getByText('drive.usage.measuring')).toBeInTheDocument());
      // Over the quota stays said while measuring.
      expect(screen.getByText('drive.usage.overBy')).toBeInTheDocument();
      await advance();
      await advance();
      await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(3));
      // The first call measures every drive; the rest only the one still walking.
      expect(onRefresh.mock.calls[0][0]).toBeUndefined();
      expect(onRefresh.mock.calls[1][0]).toEqual(['personal']);
      // Done: back to the figures, with no "measuring" left behind.
      await waitFor(() =>
        expect(screen.queryByText('drive.usage.measuring')).not.toBeInTheDocument(),
      );
      expect(toast.error).not.toHaveBeenCalledWith('drive.usage.refreshFailed');
    });

    it('should pause between calls and stop after a bounded number', async () => {
      const onRefresh = vi
        .fn()
        .mockResolvedValue({ measuring: { drives: ['personal'], scannedBytes: 1024 } });
      render(<UsageBreakdown data={overQuota(false)} onRefresh={onRefresh} />);

      fireEvent.click(screen.getByTitle('drive.usage.refresh'));

      await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
      // A call answered at once (another caller holds the walk) does not run on
      // into the next one.
      await vi.advanceTimersByTimeAsync(1000);
      expect(onRefresh).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 15; i++) await advance();
      // Bounded: the cron finishes a walk nobody is waiting on.
      expect(onRefresh).toHaveBeenCalledTimes(12);
      expect(screen.getByText('drive.usage.measuring')).toBeInTheDocument();
    });

    it('should still refresh under StrictMode, which replays effects', async () => {
      const onRefresh = vi.fn().mockResolvedValue({});
      render(
        <StrictMode>
          <UsageBreakdown data={overQuota(false)} onRefresh={onRefresh} />
        </StrictMode>,
      );

      fireEvent.click(screen.getByTitle('drive.usage.refresh'));

      await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    });

    it('should stop measuring once the panel is closed', async () => {
      let finish: (value: unknown) => void = () => {};
      const onRefresh = vi
        .fn()
        .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
        .mockResolvedValue({ measuring: { drives: ['personal'], scannedBytes: 1 } });
      const { unmount } = render(<UsageBreakdown data={overQuota(false)} onRefresh={onRefresh} />);

      fireEvent.click(screen.getByTitle('drive.usage.refresh'));
      unmount();
      finish({ measuring: { drives: ['personal'], scannedBytes: 1 } });
      await advance();
      await advance();

      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });
});
