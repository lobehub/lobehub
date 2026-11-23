/** @vitest-environment happy-dom */
import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import StatCards from './StatCards';

const visibility = vi.hoisted(() => ({ enabled: false }));
vi.mock('@/hooks/useShowMemberTokenUsage', () => ({
  useShowMemberTokenUsage: () => visibility.enabled,
}));

vi.mock('@/components/StatisticCard', () => ({
  default: ({ statistic }: { statistic: { description?: React.ReactNode; value: string } }) => (
    <div>
      {statistic.value}
      {statistic.description}
    </div>
  ),
}));
vi.mock('@/utils/usageCredits', () => ({ usageAmount: () => 31, usageAmountPrefix: () => '' }));
vi.mock('@/utils/usageCostLabel', () => ({ usageAmountSuffix: () => 'credits' }));

it.each([false, true])('gates token statistics and keeps spend (%s)', (enabled) => {
  visibility.enabled = enabled;
  const summary = {
    cacheHitRate: 0.73,
    cacheReadTokens: 72,
    cacheSavings: 0.1,
    inputTokens: 100,
    outputTokens: 443,
    totalCost: 0.31,
    totalTokens: 543,
    totalRequests: 1,
  };
  const { container } = render(<StatCards rangeLabel="week" summary={summary} />);
  expect(container.textContent).toContain('31');
  expect(container.textContent?.includes('543')).toBe(enabled);
});
