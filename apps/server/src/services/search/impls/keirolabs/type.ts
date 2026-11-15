export interface KeirolabsSearchParameters {
  maxResults?: number;
  query: string;
}

interface KeirolabsResult {
  domain?: string;
  position?: number;
  score?: number;
  snippet?: string;
  title: string;
  url: string;
}

export interface KeirolabsResponse {
  results: KeirolabsResult[];
}
