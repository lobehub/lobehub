export interface SerplySearchParameters {
  gl?: string;
  hl?: string;
  num?: number;
  q: string;
  tbs?: string;
}

interface SerplyResultMetadata {
  attributes?: string[];
  display_url?: string;
}

interface SerplyResult {
  description?: string;
  link: string;
  metadata?: SerplyResultMetadata;
  position?: number;
  realPosition?: number;
  result_type?: string;
  title: string;
}

export interface SerplyResponse {
  results?: SerplyResult[];
  total?: number;
}
