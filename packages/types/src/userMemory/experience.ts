import type { BaseListItem, BaseListParams, BaseListResult } from './shared';

/**
 * Experience query types for list display
 * These are flat structures optimized for frontend rendering
 */

export type ExperienceListSort = 'capturedAt' | 'scoreConfidence';

export interface ExperienceListParams extends BaseListParams {
  sort?: ExperienceListSort;
}

/**
 * Flat structure for experience list items
 * Contains fields needed for card display, excluding detail fields like reasoning/possibleOutcome
 */
export interface ExperienceListItem extends BaseListItem {
  action: string | null;
  keyLearning: string | null;
  scoreConfidence: number | null;
  situation: string | null;
}

export type ExperienceListResult = BaseListResult<ExperienceListItem>;
