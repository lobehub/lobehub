import { type ExperienceListItem } from '@lobechat/types';

export interface ExperienceSliceState {
  experiences: ExperienceListItem[];
  experiencesHasMore: boolean;
  experiencesInit: boolean;
  experiencesPage: number;
  experiencesQuery?: string;
  experiencesSearchError?: unknown;
  experiencesSearchLoading?: boolean;
  experiencesSort?: 'capturedAt' | 'scoreConfidence';
  experiencesTotal: number;
}

export const experienceInitialState: ExperienceSliceState = {
  experiences: [],
  experiencesHasMore: true,
  experiencesInit: false,
  experiencesPage: 1,
  experiencesQuery: undefined,
  experiencesSearchError: undefined,
  experiencesSearchLoading: undefined,
  experiencesSort: undefined,
  experiencesTotal: 0,
};
