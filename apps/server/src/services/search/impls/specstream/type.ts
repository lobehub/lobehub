export interface SpecStreamSource {
  cited?: boolean;
  published?: string | null;
  site?: string;
  snippet?: string;
  title?: string;
  url: string;
}

export interface SpecStreamPassage {
  text: string;
  title?: string;
  url: string;
}

export interface SpecStreamSearchData {
  passages?: SpecStreamPassage[] | null;
  query?: string;
  sources?: SpecStreamSource[];
}

export interface SpecStreamSearchResponse {
  data?: SpecStreamSearchData;
}
