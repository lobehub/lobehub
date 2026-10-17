// fastCRW is a Firecrawl-compatible web scraper; these types mirror the Firecrawl
// search impl shapes (cloud base https://fastcrw.com/api).
interface CrwScrapeOptions {
  blockAds?: boolean;
  formats?: string[];
  maxAge?: number;
  onlyMainContent?: boolean;
  removeBase64Images?: boolean;
}

type CrwSource =
  | { location?: string; tbs?: string; type: 'web' }
  | { type: 'images' }
  | { type: 'news' };

type CrwCategory = { type: 'github' } | { type: 'research' } | { type: 'pdf' };

export interface CrwSearchParameters {
  categories?: CrwCategory[];
  country?: string;
  ignoreInvalidURLs?: boolean;
  limit?: number;
  location?: string;
  query: string;
  scrapeOptions?: CrwScrapeOptions;
  sources?: CrwSource[];
  tbs?: string;
  timeout?: number;
}

interface CrwMetadata {
  description?: string;
  error?: string | null;
  sourceURL?: string;
  statusCode?: number;
  title?: string;
}

// fastCRW returns search hits as a flat array (Firecrawl-compatible shape:
// `{ success, data: [...] }`). Each hit carries the fields below; `category`
// distinguishes web/news/image results.
interface CrwSearchResult {
  category?: string;
  description?: string;
  html?: string | null;
  imageUrl?: string;
  markdown?: string | null;
  metadata?: CrwMetadata;
  position?: number;
  score?: number;
  snippet?: string;
  title?: string;
  url: string;
}

// Response structure
export interface CrwResponse {
  data: CrwSearchResult[];
  success: boolean;
  warning?: string | null;
}
