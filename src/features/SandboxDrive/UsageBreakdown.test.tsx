import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UsageBreakdown } from './UsageBreakdown';

vi.mock('@/business/client/features/RetainedMemberDrives', () => ({ default: () => null }));

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
});
