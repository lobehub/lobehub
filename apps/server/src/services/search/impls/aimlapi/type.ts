export interface AimlApiWebSearchInput {
  include_domains: string[] | null;
  max_results: number | null;
  query: string;
}

export interface AimlApiWebSearchResult {
  snippet?: string;
  title?: string;
  url: string;
}

export interface AimlApiToolRunResponse<T> {
  error?: { code?: string; message?: string };
  id?: string;
  is_error?: boolean;
  output?: T;
  status?: string;
  tool?: string;
}
