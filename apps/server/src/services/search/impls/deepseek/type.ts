export interface DeepSeekSearchParameters {
  count?: number;
  localization?: string;
  need_content?: boolean;
  ori_question?: string;
  query: string;
}

interface DeepSeekSearchResult {
  /**
   * 0-4, -1 when unknown; >= 3 is highly authoritative
   */
  authority?: number;
  content?: string;
  /**
   * UTC RFC 3339
   */
  date?: string | null;
  /**
   * 0-3; >= 1.5 is high quality
   */
  rerank_score?: number;
  site_icon?: string | null;
  site_name?: string | null;
  /**
   * ~100-200 characters, for display
   */
  snippet?: string;
  /**
   * ~600-800 characters, for the model to read
   */
  summary?: string;
  title?: string;
  url: string;
}

export interface DeepSeekSearchResponse {
  results: DeepSeekSearchResult[];
}
