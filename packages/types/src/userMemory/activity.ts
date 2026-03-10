import type { BaseListItem, BaseListParams, BaseListResult } from './shared';

export type ActivityListSort = 'capturedAt' | 'startsAt';

export interface ActivityListParams extends BaseListParams {
  sort?: ActivityListSort;
  status?: string[];
}

export interface ActivityListItem extends BaseListItem {
  endsAt: Date | null;
  narrative: string | null;
  notes: string | null;
  startsAt: Date | null;
  status: string | null;
  timezone: string | null;
}

export type ActivityListResult = BaseListResult<ActivityListItem>;
