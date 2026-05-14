import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { TaskTemplateCard } from './TaskTemplateCard';
import { TaskTemplateCardSkeleton } from './TaskTemplateCardSkeleton';
import type { DailyBriefRecommendationsUIState } from './useDailyBriefRecommendationsUI';

const DEFAULT_RECOMMENDATION_SKELETON_KEYS = ['first', 'second', 'third'];

interface DailyBriefRecommendationsViewProps {
  state: DailyBriefRecommendationsUIState;
}

export const DailyBriefRecommendationsView = memo<DailyBriefRecommendationsViewProps>(
  ({ state }) => {
    if (state.mode === 'hidden') return null;
    if (state.mode === 'skeleton') {
      return (
        <Flexbox gap={8}>
          {DEFAULT_RECOMMENDATION_SKELETON_KEYS.map((key) => (
            <TaskTemplateCardSkeleton key={key} />
          ))}
        </Flexbox>
      );
    }

    return (
      <Flexbox gap={8}>
        {state.templates.map((tmpl) => (
          <TaskTemplateCard
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
