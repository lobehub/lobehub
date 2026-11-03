// V2 API Types
interface FirecrawlScrapeOptions {
  blockAds?: boolean;
  formats?: string[];
  maxAge?: number;
  onlyMainContent?: boolean;
  removeBase64Images?: boolean;
}

type FirecrawlSource =
  | { location?: string; tbs?: string; type: 'web' }
  | { type: 'images' }
  | { type: 'news' };

type FirecrawlCategory = { type: 'github' } | { type: 'research' } | { type: 'pdf' };

export interface FirecrawlSearchParameters {
  categories?: FirecrawlCategory[];
  country?: string;
  ignoreInvalidURLs?: boolean;
  limit?: number;
  location?: string;
  query: string;
  scrapeOptions?: FirecrawlScrapeOptions;
  sources?: FirecrawlSource[];
  tbs?: string;
  timeout?: number;
}

interface FirecrawlMetadata {
  description?: string;
  error?: string | null;
  sourceURL?: string;
  statusCode?: number;
  title?: string;
}

// Web search result
interface FirecrawlWebResult {
  description: string;
  html?: string | null;
  links?: string[];
  markdown?: string | null;
  metadata?: FirecrawlMetadata;
  rawHtml?: string | null;
  screenshot?: string | null;
  title: string;
  url: string;
}

// Image search result
interface FirecrawlImageResult {
  imageHeight: number;
  imageUrl: string;
  imageWidth: number;
  position: number;
  title: string;
  url: string;
}

// News search result
interface FirecrawlNewsResult {
  date: string;
  html?: string | null;
  imageUrl?: string;
  links?: string[];
  markdown?: string | null;
  metadata?: FirecrawlMetadata;
  position: number;
  rawHtml?: string | null;
  screenshot?: string | null;
  snippet: string;
  title: string;
  url: string;
}

// V2 Response structure
export interface FirecrawlResponse {
  data: {
    images?: FirecrawlImageResult[];
    news?: FirecrawlNewsResult[];
    web?: FirecrawlWebResult[];
  };
  success: boolean;
  warning?: string | null;
}
