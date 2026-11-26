import { type AssistantQueryParams, AssistantSorts } from '@/types/discover';

/** Request individual agents and groups together from the Marketplace. */
export const buildAssistantListQuery = (params: AssistantQueryParams): AssistantQueryParams => ({
  category: params.category,
  includeAgentGroup: true,
  includeCategoryCounts: params.includeCategoryCounts ?? Boolean(params.q?.trim()),
  order: params.order,
  page: params.page,
  pageSize: params.pageSize ?? 21,
  q: params.q,
  sort: params.sort ?? AssistantSorts.Recommended,
  source: params.source,
});
