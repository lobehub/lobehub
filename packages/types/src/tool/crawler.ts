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
  url?: string;
}

export interface CrawlUniformResult {
  crawler: string;
  data: CrawlSuccessResult | CrawlErrorResult;
  originalUrl: string;
  transformedUrl?: string;
}

export interface CrawlSinglePageQuery {
  url: string;
}

export interface CrawlMultiPagesQuery {
  urls: string[];
}

export interface CrawlResult {
  crawler: string;
  data: CrawlSuccessResult | CrawlErrorResult;
  originalUrl: string;
}

export interface CrawlPluginState {
  results: CrawlResult[];
}
