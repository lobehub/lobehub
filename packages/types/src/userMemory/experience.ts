/**
 * Experience query types for list display
 * These are flat structures optimized for frontend rendering
 */

export type ExperienceListSort = 'capturedAt' | 'scoreConfidence';

export interface ExperienceListParams {
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: ExperienceListSort;
  tags?: string[];
  types?: string[];
}

/**
 * Flat structure for experience list items
 * Contains fields needed for card display, excluding detail fields like reasoning/possibleOutcome
 */
export interface ExperienceListItem {
  action: string | null;
  capturedAt: Date;
  createdAt: Date;
  id: string;
  keyLearning: string | null;
  scoreConfidence: number | null;
  situation: string | null;
  tags: string[] | null;
  title: string | null;
  type: string | null;
  updatedAt: Date;
}

export interface ExperienceListResult {
  items: ExperienceListItem[];
  page: number;
  pageSize: number;
  total: number;
}
