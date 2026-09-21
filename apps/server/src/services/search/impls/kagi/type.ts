export interface KagiSearchParameters {
  limit?: number;
  query: string;
}

interface KagiSearchImage {
  height?: number | null;
  url?: string;
  width?: number | null;
}

interface KagiSearchResult {
  image?: KagiSearchImage;
  props?: Record<string, unknown>;
  snippet?: string;
  time?: string;
  title: string;
  url: string;
}

interface KagiData {
  infobox?: unknown;
  search: KagiSearchResult[];
}

export interface KagiResponse {
  data: KagiData;
}
