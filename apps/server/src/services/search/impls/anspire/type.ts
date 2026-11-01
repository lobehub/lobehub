export interface AnspireSearchParameters {
  FromTime?: string;
  Insite?: string;
  mode?: number;
  query: string;
  top_k?: number;
  ToTime?: string;
}

interface AnspireResults {
  content?: string;
  score?: number;
  title: string;
  url: string;
}

export interface AnspireResponse {
  query?: string;
  results?: AnspireResults[];
  Uuid?: string;
}
