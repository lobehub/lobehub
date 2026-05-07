import { memo } from 'react';

import type { DailyBriefRecommendationsUIState } from './useDailyBriefRecommendationsUI';

interface DailyBriefRecommendationsProps {
  state: DailyBriefRecommendationsUIState;
}

/** Cloud repo overrides this module to render task template recommendations inside Daily brief. */
export const DailyBriefRecommendations = memo<DailyBriefRecommendationsProps>(() => null);

DailyBriefRecommendations.displayName = 'DailyBriefRecommendations';
