export interface ExaSearchParameters {
  category?: string;
  endCrawlDate?: string;
  endPublishedDate?: string;
  excludeDomains?: string[];
  excludeText?: string[];
  includeDomains?: string[];
  includeText?: string[];
  numResults?: number;
  query: string;
  startCrawlDate?: string;
  startPublishedDate?: string;
  type?: string;
}

interface ExaCostDollars {
  total: number;
}

interface ExaResults {
  author?: string | null;
  favicon?: string;
  id?: string;
  image?: string;
  publishedDate?: string | null;
  score?: number | null;
  summery?: string;
  text: string;
  title: string;
  url: string;
}

export interface ExaResponse {
  costDollars?: ExaCostDollars;
  requestId?: string;
  resolvedSearchType?: string;
  results: ExaResults[];
  searchType?: string;
}
