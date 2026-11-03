import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { TaskTemplateCard } from './TaskTemplateCard';
import { TaskTemplateCardSkeleton } from './TaskTemplateCardSkeleton';
import type { DailyBriefRecommendationsUIState } from './useDailyBriefRecommendationsUI';

interface DailyBriefRecommendationsViewProps {
  compact?: boolean;
  state: DailyBriefRecommendationsUIState;
}

export const DailyBriefRecommendationsView = memo<DailyBriefRecommendationsViewProps>(
  ({ compact, state }) => {
    const gap = compact ? 2 : 8;

    if (state.mode === 'hidden') return null;
    if (state.mode === 'skeleton') {
      return (
        <Flexbox gap={gap}>
          {Array.from({ length: state.skeletonCount }, (_, index) => (
            <TaskTemplateCardSkeleton compact={compact} key={`task-template-skeleton-${index}`} />
          ))}
        </Flexbox>
      );
    }

    return (
      <Flexbox gap={gap}>
        {state.templates.map((tmpl) => (
          <TaskTemplateCard
            compact={compact}
            key={tmpl.id}
            template={tmpl}
            onCreated={state.onCreated}
            onDismiss={state.onDismiss}
          />
        ))}
      </Flexbox>
    );
  },
);

DailyBriefRecommendationsView.displayName = 'DailyBriefRecommendationsView';
