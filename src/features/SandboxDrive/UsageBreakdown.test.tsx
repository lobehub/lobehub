import type * as LobeUI from '@lobehub/ui';
import { toast } from '@lobehub/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UsageBreakdown } from './UsageBreakdown';

vi.mock('@/business/client/features/RetainedMemberDrives', () => ({ default: () => null }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));
const workspace = vi.hoisted(() => ({ id: 'ws-a' as string | null }));
vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => workspace.id,
}));
vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof LobeUI>();
  return {
    ...actual,
    // Real base-ui ActionIcon only surfaces its title via a hover Tooltip, so
    // a plain button stands in to make the refresh clickable by its label.
    ActionIcon: ({
      loading,
      onClick,
      title,
    }: {
      loading?: boolean;
      onClick?: () => void;
      title?: string;
    }) => <button data-loading={!!loading} title={title} type="button" onClick={onClick} />,
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
  // A toast from one case must not answer for the next one's assertion.
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
  });

  it('should say saves are refused over a quota the plan does not bill past', () => {
    render(<UsageBreakdown data={overQuota(false)} onRefresh={vi.fn()} />);

    expect(screen.getByText('drive.usage.over')).toBeInTheDocument();
    expect(screen.queryByText('drive.usage.overBilled')).not.toBeInTheDocument();
  });

  it('should offer the space cleanup while saves are refused', () => {
    render(<UsageBreakdown data={overQuota(false)} onRefresh={vi.fn()} />);

    fireEvent.click(screen.getByText('drive.cleanup.open'));

    expect(navigate).toHaveBeenCalledWith('/resource/sandbox-storage?view=cleanup');
  });

  it('should keep the drive tab being viewed when opened from the storage page', () => {
    window.history.pushState({}, '', '/resource/sandbox-storage?drive=personal');
    render(<UsageBreakdown data={overQuota(false)} onRefresh={vi.fn()} />);

    fireEvent.click(screen.getByText('drive.cleanup.open'));

    expect(navigate).toHaveBeenLastCalledWith(
      '/resource/sandbox-storage?view=cleanup&drive=personal',
    );
    window.history.pushState({}, '', '/');
  });

  it('should not push a cleanup when the overage is billed', () => {
    render(<UsageBreakdown data={overQuota(true)} onRefresh={vi.fn()} />);

    expect(screen.queryByText('drive.cleanup.open')).not.toBeInTheDocument();
  });

  it('should say the overage is billed when the plan allows it', () => {
    // Pay-as-you-go keeps writes going; "free up space before saving" would
    // be untrue there.
    render(<UsageBreakdown data={overQuota(true)} onRefresh={vi.fn()} />);

    expect(screen.getByText('drive.usage.overBilled')).toBeInTheDocument();
    expect(screen.queryByText('drive.usage.over')).not.toBeInTheDocument();
  });

  // A refresh whose walk timed out used to answer with the old figure as if
  // it had been re-measured.
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

  // A drive too large to walk in one call is measured over several calls.
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

    it('should say in the open that the figure is the last finished measurement', async () => {
      const onRefresh = vi
        .fn()
        .mockResolvedValue({ measuring: { drives: ['personal'], scannedBytes: 1 } });
      render(<UsageBreakdown data={overQuota(false)} onRefresh={onRefresh} />);

      fireEvent.click(screen.getByTitle('drive.usage.refresh'));

      // Visible text, not a tooltip: touch screens cannot hover.
      await waitFor(() =>
        expect(screen.getByText('drive.usage.measuringHint')).toBeInTheDocument(),
      );
    });

    it('should stop calling once the page is hidden', async () => {
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      const onRefresh = vi
        .fn()
        .mockResolvedValue({ measuring: { drives: ['personal'], scannedBytes: 1 } });
      render(<UsageBreakdown data={overQuota(false)} onRefresh={onRefresh} />);

      fireEvent.click(screen.getByTitle('drive.usage.refresh'));
      await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
      visibility.mockReturnValue('hidden');
      for (let i = 0; i < 5; i++) await advance();

      expect(onRefresh).toHaveBeenCalledTimes(1);
      // Still says it is measuring: the walk goes on without this tab.
      expect(screen.getByText('drive.usage.measuring')).toBeInTheDocument();
      visibility.mockRestore();
    });

    it('should stop measuring when the active workspace changes', async () => {
      workspace.id = 'ws-a';
      const onRefresh = vi
        .fn()
        .mockResolvedValue({ measuring: { drives: ['personal'], scannedBytes: 1 } });
      const { rerender } = render(<UsageBreakdown data={overQuota(false)} onRefresh={onRefresh} />);

      fireEvent.click(screen.getByTitle('drive.usage.refresh'));
      await waitFor(() => expect(screen.getByText('drive.usage.measuring')).toBeInTheDocument());

      // Same route, another workspace: requests would now go to it.
      workspace.id = 'ws-b';
      rerender(<UsageBreakdown data={overQuota(false)} onRefresh={onRefresh} />);
      for (let i = 0; i < 5; i++) await advance();

      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('drive.usage.measuring')).not.toBeInTheDocument();
      workspace.id = 'ws-a';
    });

    it("should keep one workspace's refresh spinner out of another", async () => {
      workspace.id = 'ws-a';
      let finishA: (value: unknown) => void = () => {};
      let finishB: (value: unknown) => void = () => {};
      const onRefresh = vi
        .fn()
        .mockImplementationOnce(() => new Promise((resolve) => (finishA = resolve)))
        .mockImplementationOnce(() => new Promise((resolve) => (finishB = resolve)));
      const view = () => <UsageBreakdown data={overQuota(false)} onRefresh={onRefresh} />;
      const { rerender } = render(view());
      const button = () => screen.getByTitle('drive.usage.refresh');

      fireEvent.click(button());
      await waitFor(() => expect(button().dataset.loading).toBe('true'));

      // A's request is still in flight; B is not refreshing.
      workspace.id = 'ws-b';
      rerender(view());
      expect(button().dataset.loading).toBe('false');

      // B starts its own; A finishing must not clear it.
      fireEvent.click(button());
      await waitFor(() => expect(button().dataset.loading).toBe('true'));
      finishA({});
      await advance();
      expect(button().dataset.loading).toBe('true');
      finishB({});
      await waitFor(() => expect(button().dataset.loading).toBe('false'));
      workspace.id = 'ws-a';
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
