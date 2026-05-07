import type { TaskTemplate } from '@lobechat/const';

export interface DailyBriefRecommendationsUIStateHidden {
  mode: 'hidden';
}

export interface DailyBriefRecommendationsUIStateSkeleton {
  mode: 'skeleton';
}

export interface DailyBriefRecommendationsUIStateCards {
  mode: 'cards';
  onDismiss: (templateId: string) => void;
  templates: TaskTemplate[];
}

export type DailyBriefRecommendationsUIState =
  | DailyBriefRecommendationsUIStateCards
  | DailyBriefRecommendationsUIStateHidden
  | DailyBriefRecommendationsUIStateSkeleton;

export function useDailyBriefRecommendationsUI(): DailyBriefRecommendationsUIState {
  return { mode: 'hidden' };
}
