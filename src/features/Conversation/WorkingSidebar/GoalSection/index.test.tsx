import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import GoalSection from './index';

vi.mock('./GoalWorkflowCard', () => ({
  default: ({ initialCollapsed }: { initialCollapsed?: boolean }) => (
    <div data-collapsed={initialCollapsed ? 'true' : 'false'} data-testid={'goal-card'} />
  ),
}));

vi.mock('./useGoalSection', () => ({
  useTopicOperationGoals: () => [
    { criteriaCount: 5, goalId: 'goal-old', name: '旧目标' },
    { criteriaCount: 3, goalId: 'goal-new', name: '新目标' },
  ],
}));

describe('GoalSection', () => {
  it('keeps only the newest goal card open by default', () => {
    render(<GoalSection />);

    const cards = screen.getAllByTestId('goal-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('data-collapsed', 'true');
    expect(cards[1]).toHaveAttribute('data-collapsed', 'false');
  });
});
