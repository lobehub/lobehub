export interface KeenableSearchParameters {
  mode?: 'pro';
  /** `YYYY-MM-DD`; pages without a publish date are kept. */
  published_after?: string;
  /** `YYYY-MM-DD`; pages without a publish date are kept. */
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
