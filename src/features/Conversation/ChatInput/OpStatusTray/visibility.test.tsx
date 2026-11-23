/** @vitest-environment happy-dom */
import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import OpStatusTray from '../OpStatusTray';

const visibility = vi.hoisted(() => ({ enabled: false }));
vi.mock('@/hooks/useShowMemberTokenUsage', () => ({
  useShowMemberTokenUsage: () => visibility.enabled,
}));

vi.mock('../../store', () => ({
  contextSelectors: {},
  dataSelectors: {},
  useConversationStore: () => [],
}));
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: object) => unknown) => selector({ operationsByMessage: {} }),
}));
vi.mock('@/store/chat/selectors', () => ({
  operationSelectors: {
    getOperationsByContext: () => () => [
      {
        id: 'op',
        metadata: { startTime: 1, stepCount: 3 },
        status: 'running',
        type: 'execAgentRuntime',
      },
    ],
    isSteerHandoffPending: () => () => false,
  },
}));
vi.mock('@/utils/operationUsageMetrics', () => ({
  calculateOperationUsageMetrics: () => ({ totalCost: 0.31, totalTokens: 543 }),
}));
vi.mock('@/utils/usageCredits', () => ({
  formatUsageCost: () => '31 credits',
  isUsageCreditsEnabled: () => true,
}));

it.each([false, true])('shows the charge and gates cumulative tokens (%s)', (enabled) => {
  visibility.enabled = enabled;
  const { container } = render(<OpStatusTray />);
  expect(container.textContent).toContain('31 credits');
  expect(container.textContent?.includes('543')).toBe(enabled);
});
