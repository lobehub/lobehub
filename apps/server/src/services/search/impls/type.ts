import { type SearchParams, type UniformSearchResponse } from '@lobechat/types';

/**
 * Search service implementation interface.
 */
export interface SearchServiceImpl {
  /**
   * Query for search results
   */
  query: (query: string, params?: SearchParams) => Promise<UniformSearchResponse>;

  /**
   * The provider selects the best engine itself. Do not forward explicit engine
   * restrictions or retry by removing them.
   */
  useAutoSearchEngineSelection?: boolean;

  /**
   * The provider sends none of the search params (categories, engines, time range).
   * Retrying with fewer params would repeat the same request, so the service asks once.
   */
  ignoresSearchParams?: boolean;
}
