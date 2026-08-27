import { type AssistantQueryParams, AssistantSorts } from '@/types/discover';

/** Keep the list and category sidebar on the same SWR request. */
export const buildAssistantListQuery = (params: AssistantQueryParams): AssistantQueryParams => ({
  category: params.category,
  includeAgentGroup: true,
  includeCategoryCounts: Boolean(params.q?.trim()),
  order: params.order,
  page: params.page,
  pageSize: 21,
  q: params.q,
  sort: params.sort ?? AssistantSorts.Recommended,
  source: params.source,
});
