/**
 * SearchApi serves every engine from one endpoint, so the engine id stays an open string
 * rather than an enum: `SEARCHAPI_ENGINE` accepts any id the API supports.
 */
export type SearchApiEngine = string;

export interface SearchApiSearchParameters {
  /** The query terms. */
  q: string;
  /** Restricts results to a recent window. */
  time_period?: SearchApiTimePeriod;
  /** SearchApi engine id, for example `google` or `google_news`. */
  engine: SearchApiEngine;
}

export type SearchApiTimePeriod =
  | 'last_hour'
  | 'last_day'
  | 'last_week'
  | 'last_month'
  | 'last_year';

export interface SearchApiResultItem {
  content?: string;
  date?: string;
  description?: string;
  link: string;
  published_date?: string;
  snippet?: string;
  source?: string;
  thumbnail?: string;
  title?: string;
}

/**
 * One optional array per engine. Only the array matching the requested engine is populated,
 * so callers read whichever one is present.
 */
export interface SearchApiResponse {
  error?: string;
  jobs?: SearchApiResultItem[];
  organic_results?: SearchApiResultItem[];
  search_metadata?: Record<string, unknown>;
  search_parameters?: Record<string, unknown>;
  shopping_results?: SearchApiResultItem[];
  videos?: SearchApiResultItem[];
}
