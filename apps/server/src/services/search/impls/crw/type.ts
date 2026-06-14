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

// Web search result
interface CrwWebResult {
  description: string;
  html?: string | null;
  links?: string[];
  markdown?: string | null;
  metadata?: CrwMetadata;
  rawHtml?: string | null;
  screenshot?: string | null;
  title: string;
  url: string;
}

// Image search result
interface CrwImageResult {
  imageHeight: number;
  imageUrl: string;
  imageWidth: number;
  position: number;
  title: string;
  url: string;
}

// News search result
interface CrwNewsResult {
  date: string;
  html?: string | null;
  imageUrl?: string;
  links?: string[];
  markdown?: string | null;
  metadata?: CrwMetadata;
  position: number;
  rawHtml?: string | null;
  screenshot?: string | null;
  snippet: string;
  title: string;
  url: string;
}

// Response structure
export interface CrwResponse {
  data: {
    images?: CrwImageResult[];
    news?: CrwNewsResult[];
    web?: CrwWebResult[];
  };
  success: boolean;
  warning?: string | null;
}
