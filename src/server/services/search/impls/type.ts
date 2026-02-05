import type {SearchParams, UniformSearchResponse} from '@lobechat/types';

/**
 * Search service implementation interface
 */
export interface SearchServiceImpl {
  /**
   * Query for search results
   */
  query: (query: string, params?: SearchParams) => Promise<UniformSearchResponse>;
}
