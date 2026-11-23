/** @vitest-environment happy-dom */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

import GoalRoundPopover from './GoalRoundPopover';

const visibility = vi.hoisted(() => ({ enabled: false }));
vi.mock('@/hooks/useShowMemberTokenUsage', () => ({
  useShowMemberTokenUsage: () => visibility.enabled,
}));

vi.mock('@lobehub/ui', async (load) => ({
  ...(await load<object>()),
  Popover: ({ content }: { content: ReactNode }) => content,
}));
vi.mock('@/utils/usageCostLabel', () => ({ formatUsageCostLabel: () => '31 credits' }));

it.each([false, true])('keeps credits and gates the round token count (%s)', (enabled) => {
  visibility.enabled = enabled;
  const { container } = render(
    <GoalRoundPopover duration="2s" index={1} usage={{ cost: 0.31, tokens: 543 }}>
      <span />
    </GoalRoundPopover>,
  );
  expect(container.textContent).toContain('31 credits');
  expect(container.textContent?.includes('543')).toBe(enabled);
});
