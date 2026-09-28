import type { CrawlMultiPagesQuery, CrawlUniformResult } from '../crawler';

export interface SearchParams {
  searchCategories?: string[];
  searchEngines?: string[];
  searchTimeRange?: string;
}

export interface SearchQuery extends SearchParams {
  query: string;
}

export const SEARCH_SEARXNG_NOT_CONFIG = 'SearXNG is not configured';

export interface SearchContent {
  content?: string;
  img_src?: string;
  publishedDate?: string | null;
  thumbnail?: string | null;
  title: string;
  url: string;
}

export interface UniformSearchResult {
  category?: string;
  content: string;
  engines: string[];
  /**
   * Used for video results
   */
  iframeSrc?: string;
  imgSrc?: string;
  parsedUrl: string;
  publishedDate?: string;
  score: number;
  thumbnail?: string;
  title: string;
  url: string;
}

export interface UniformSearchResponse {
  costTime: number;
  errorDetail?: string;
  query: string;
  /**
   * How many hits `results` held, pinned by the read-path projector before it
   * drops them. The collapsed chip shows only this number; the card hydrates
   * the real hits when the row is expanded.
   */
  resultCount?: number;
  resultNumbers: number;
  results: UniformSearchResult[];
}

export interface SearchServiceImpl {
  crawlPages: (
    params: CrawlMultiPagesQuery,
    options?: { signal?: AbortSignal },
  ) => Promise<{ results: CrawlUniformResult[] }>;
  webSearch: (
    params: SearchQuery,
    options?: { signal?: AbortSignal },
  ) => Promise<UniformSearchResponse>;
}
