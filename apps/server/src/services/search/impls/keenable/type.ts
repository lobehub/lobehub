export interface KeenableSearchParameters {
  mode?: 'pro';
  published_after?: string;
  published_before?: string;
  query: string;
  site?: string;
}

interface KeenableResult {
  acquired_at?: string;
  /** Frequently empty; `snippet` is where the page text is. */
  description?: string;
  published_at?: string | null;
  /** Raw page text, newlines included. */
  snippet?: string;
  title?: string;
  url: string;
}

export interface KeenableResponse {
  query?: string;
  results: KeenableResult[];
}
