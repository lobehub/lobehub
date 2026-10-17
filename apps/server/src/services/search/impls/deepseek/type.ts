export interface DeepSeekSearchParameters {
  count?: number;
  localization?: string;
  need_content?: boolean;
  ori_question?: string | null;
  query: string;
}

export interface DeepSeekSearchResultItem {
  authority: number;
  content: string;
  date: string | null;
  rerank_score: number;
  site_icon: string | null;
  site_name: string | null;
  snippet: string;
  summary: string;
  title: string;
  url: string;
}

export interface DeepSeekSearchResponse {
  results: DeepSeekSearchResultItem[];
}
