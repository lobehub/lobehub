import { type ActivityListItem } from '@lobechat/types';

export interface ActivitySliceState {
  activities: ActivityListItem[];
  activitiesHasMore: boolean;
  activitiesInit: boolean;
  activitiesPage: number;
  activitiesQuery?: string;
  activitiesSearchError?: unknown;
  activitiesSearchLoading?: boolean;
  activitiesSort?: 'capturedAt' | 'startsAt';
  activitiesTotal: number;
}

export const activityInitialState: ActivitySliceState = {
  activities: [],
  activitiesHasMore: true,
  activitiesInit: false,
  activitiesPage: 1,
  activitiesQuery: undefined,
  activitiesSearchError: undefined,
  activitiesSearchLoading: undefined,
  activitiesSort: undefined,
  activitiesTotal: 0,
};
