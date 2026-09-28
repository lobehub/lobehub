export interface CrawlSuccessResult {
  content?: string;
  contentType: 'text' | 'json';
  description?: string;
  length?: number;
  siteName?: string;
  title?: string;
  url: string;
}

export interface CrawlErrorResult {
  content: string;
  errorMessage?: string;
  errorType?: string;
  /**
   * `false` when re-issuing the same crawl cannot succeed (dead link, invalid URL,
   * resource file, rejected request). Absent means a retry may be worthwhile.
   */
  retryable?: boolean;
  url?: string;
}

export interface FilterOptions {
  // Whether to enable Readability
  enableReadability?: boolean;

  pureText?: boolean;
}

type CrawlImplType = 'naive' | 'jina' | 'browserless' | 'search1api';

type CrawlImplParams<T> = T & {
  filterOptions: FilterOptions;
};

export type CrawlImpl<Params = object> = (
  url: string,
  params: CrawlImplParams<Params>,
) => Promise<CrawlSuccessResult | undefined>;

export interface CrawlUrlRule {
  // Content filtering configuration (optional)
  filterOptions?: FilterOptions;
  impls?: CrawlImplType[];
  // URL matching pattern, only supports regular expressions
  urlPattern: string;
  // URL transformation template (optional), performs URL conversion if provided
  urlTransform?: string;
}

export interface CrawlUniformResult {
  crawler: string;
  data: CrawlSuccessResult | CrawlErrorResult;
  originalUrl: string;
  transformedUrl?: string;
}
