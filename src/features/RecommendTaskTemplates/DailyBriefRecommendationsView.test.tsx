import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DailyBriefRecommendationsView } from './DailyBriefRecommendationsView';

vi.mock('./TaskTemplateCard', () => ({
  TaskTemplateCard: () => <div data-testid={'task-template-card'} />,
}));

describe('DailyBriefRecommendationsView', () => {
  it('uses task-template card skeletons while loading recommendations', () => {
    render(<DailyBriefRecommendationsView state={{ mode: 'skeleton' }} />);

    expect(screen.getAllByTestId('task-template-card-skeleton')).toHaveLength(2);
  });
});
