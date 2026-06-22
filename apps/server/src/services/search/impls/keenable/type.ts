export interface KeenableSearchParameters {
  mode?: 'pro' | 'realtime';
  published_after?: string;
  published_before?: string;
  query: string;
  site?: string;
}

interface KeenableResult {
  acquired_at?: string;
  description?: string;
  published_at?: string | null;
  title?: string;
  url: string;
}

export interface KeenableResponse {
  query?: string;
  results: KeenableResult[];
}
