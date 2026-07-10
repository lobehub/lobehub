export interface BochaSearchParameters {
  count?: number;
  exclude?: string;
  freshness?: string;
  include?: string;
  query: string;
  summary?: boolean;
}

interface BochaQueryContext {
  originalQuery: string;
}

interface BochaValue {
  cachedPageUrl?: string;
  dateLastCrawled?: string;
  displayUrl?: string;
  id?: string | null;
  isFamilyFriendly?: boolean;
  isNavigational?: boolean;
  language?: string;
  name: string;
  siteName?: string;
  snippet?: string;
  summary?: string;
  url: string;
}

interface BochaWebPages {
  totalEstimatedMatches?: number;
  value?: BochaValue[];
  webSearchUrl?: string;
}

interface BochaData {
  images?: any;
  queryContext?: BochaQueryContext;
  videos?: any;
  webPages: BochaWebPages;
}

export interface BochaResponse {
  code?: number;
  data: BochaData;
  log_id?: string;
  msg?: string | null;
}
