/**
 * The query you want to ask
 */
export type Query = string;

export const SEARCH1API_SUPPORT_SEARCH_SERVICE = [
  'google',
  'bing',
  'duckduckgo',
  'yahoo',
  'youtube',
  'x',
  'reddit',
  'github',
  'arxiv',
  'wechat',
  'bilibili',
  'imdb',
  'wikipedia',
] as const;

/**
 * The search service you want to choose
 */
export type SearchService = (typeof SEARCH1API_SUPPORT_SEARCH_SERVICE)[number];

/**
 * The results you want to have
 */
export type MaxResults = number;
/**
 * The results you want to crawl
 */
export type CrawlResults = number;
/**
 * Search including image urls
 */
export type Image = boolean;
/**
 * List of websites to include in search results
 */
export type IncludeSites = string[];
/**
 * List of websites to exclude from search results
 */
export type ExcludeSites = string[];
/**
 * The language preference for search results (e.g., 'en', 'zh-CN', 'fr'). Uses standard language codes.
 */
export type Language = string;
/**
 * Limit search results to a specific time range
 */
export type TimeRange = 'day' | 'month' | 'year';

export interface Search1ApiSearchParameters {
  crawl_results?: CrawlResults;
  exclude_sites?: ExcludeSites;
  image?: Image;
  include_sites?: IncludeSites;
  language?: Language;
  max_results?: MaxResults;
  query: Query;
  search_service?: SearchService;
  time_range?: TimeRange;
}

interface Search1ApiResult {
  content?: string;
  link: string;
  snippet?: string;
  title?: string;
}

export interface Search1ApiResponseItem {
  data: {
    results?: Search1ApiResult[];
    searchParameters?: Search1ApiSearchParameters;
  };
  success: boolean;
}

/**
 * @deprecated Use Search1ApiRawResponse instead
 */
export interface Search1ApiResponse {
  results?: Search1ApiResult[];
  searchParameters?: Search1ApiSearchParameters;
}

export interface Search1ApiRawResponse {
  results: Search1ApiResponseItem[];
  summary?: string;
}
