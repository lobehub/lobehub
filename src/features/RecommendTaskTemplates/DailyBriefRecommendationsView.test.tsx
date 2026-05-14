import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DailyBriefRecommendationsView } from './DailyBriefRecommendationsView';

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('./TaskTemplateCard', () => ({
  TaskTemplateCard: () => <div data-testid={'task-template-card'} />,
}));

vi.mock('./TaskTemplateCardSkeleton', () => ({
  TaskTemplateCardSkeleton: () => <div data-testid={'task-template-card-skeleton'} />,
}));

describe('DailyBriefRecommendationsView', () => {
  it('uses task-template card skeletons while loading recommendations', () => {
    render(<DailyBriefRecommendationsView state={{ mode: 'skeleton' }} />);

    expect(screen.getAllByTestId('task-template-card-skeleton')).toHaveLength(3);
  });
});
