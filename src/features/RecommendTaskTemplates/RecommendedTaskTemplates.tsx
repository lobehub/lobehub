import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import { BriefCardSkeleton } from '@/features/DailyBrief/BriefCardSkeleton';

import { TaskTemplateCard } from './TaskTemplateCard';
import type { TaskTemplateRecommendationsState } from './useTaskTemplateRecommendations';

interface RecommendedTaskTemplatesProps {
  state: TaskTemplateRecommendationsState;
}

export const RecommendedTaskTemplates = memo<RecommendedTaskTemplatesProps>(({ state }) => {
  if (state.mode === 'hidden') return null;
  if (state.mode === 'skeleton') {
    return (
      <Flexbox gap={8}>
        <BriefCardSkeleton />
        <BriefCardSkeleton />
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={8}>
      {state.templates.map((tmpl, index) => (
        <TaskTemplateCard
          key={tmpl.id}
          position={index}
          recommendationBatchId={state.recommendationBatchId}
          spmRoot={state.spmRoot}
          template={tmpl}
          userInterestCount={state.userInterestCount}
          onCreated={state.onCreated}
          onDismiss={state.onDismiss}
        />
      ))}
    </Flexbox>
  );
});

RecommendedTaskTemplates.displayName = 'RecommendedTaskTemplates';
