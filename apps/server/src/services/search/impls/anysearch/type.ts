export interface AnySearchResult {
  content?: string;
  snippet?: string;
  title: string;
  url?: string;
}

export interface AnySearchResponse {
  code: number;
  data?: {
    metadata?: {
      search_time_ms?: number;
      total_results?: number;
    };
    results?: AnySearchResult[];
  };
  message?: string;
  request_id?: string;
}
