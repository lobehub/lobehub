import type { BriefItem } from '@lobechat/types';

import { briefService } from '@/services/brief';

import { defineProjectionQuery } from '../../query/runtime';
import { getProjectionStoreState } from '../../store';

export interface BriefNewsQueryParams {
  day: string;
  endAt: Date;
  startAt: Date;
}

export interface BriefNewsQueryResponse {
  day: string;
  hasEarlier: boolean;
  news: BriefItem[];
}

export const briefNewsProjectionQuery = defineProjectionQuery<
  BriefNewsQueryParams,
  BriefNewsQueryResponse
>({
  project: (result, { observedAt, scope }) => {
    getProjectionStoreState().commitBriefNews(
      scope,
      result.day,
      result.hasEarlier,
      result.news,
      observedAt,
    );
  },
  query: async ({ day, endAt, startAt }) => {
    const result = await briefService.listNewsByDay({ endAt, startAt });
    return { day, hasEarlier: result.hasEarlier, news: result.data as BriefItem[] };
  },
});
