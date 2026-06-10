export interface TavilySearchParameters {
  chunks_per_source?: number;
  days?: number;
  exclude_domains?: string[];
  include_answer?: boolean | string;
  include_domains?: string[];
  include_image_descriptions?: boolean;
  include_images?: boolean;
  include_raw_content?: boolean;
  max_results?: number;
  query: string;
  search_depth?: string;
  time_range?: string;
  topic?: string;
}

interface TavilyImages {
  description?: string;
  url: string;
}

interface TavilyResults {
  content?: string;
  raw_content?: string | null;
  score?: number;
  title?: string;
  url: string;
}

export interface TavilyResponse {
  answer?: string;
  images?: TavilyImages[];
  query: string;
  response_time: number;
  results: TavilyResults[];
}
