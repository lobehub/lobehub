/** @vitest-environment happy-dom */
import type { EvalRunMetrics } from '@lobechat/types';
import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import StatsCards from './index';

const visibility = vi.hoisted(() => ({ enabled: false }));
vi.mock('@/hooks/useShowMemberTokenUsage', () => ({
  useShowMemberTokenUsage: () => visibility.enabled,
}));

vi.mock('@/utils/usageCostLabel', () => ({ formatUsageCostLabel: () => '31 credits' }));

it.each([false, true])(
  'keeps the charge and gates aggregate and per-case tokens (%s)',
  (enabled) => {
    visibility.enabled = enabled;
    const metrics = { perCaseTokens: 127, totalCost: 0.31, totalTokens: 543 } as EvalRunMetrics;
    const { container } = render(<StatsCards metrics={metrics} />);
    expect(container.textContent?.includes('543')).toBe(enabled);
    expect(container.textContent?.includes('127')).toBe(enabled);
    if (!enabled) expect(container.textContent).toContain('31 credits');
  },
);
