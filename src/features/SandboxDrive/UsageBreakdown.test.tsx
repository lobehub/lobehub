import type * as LobeUI from '@lobehub/ui';
import { toast } from '@lobehub/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
});
