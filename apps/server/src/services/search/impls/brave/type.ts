export interface BraveSearchParameters {
  count?: number;
  country?: string;
  enable_rich_callback?: boolean;
  extra_snippets?: boolean;
  freshness?: string;
  goggles?: string[];
  goggles_id?: string;
  offset?: number;
  q: string;
  result_filter?: string;
  safesearch?: string;
  search_lang?: string;
  spellcheck?: boolean;
  summary?: boolean;
  text_decorations?: boolean;
  ui_lang?: string;
  units?: string;
}

interface BraveResults {
  age?: string;
  description: string;
  family_friendly?: boolean;
  is_live?: boolean;
  is_source_both?: boolean;
  is_source_local?: boolean;
  language?: string;
  meta_url?: any;
  page_age?: string;
  profile?: any;
  subtype?: string;
  thumbnail?: any;
  title: string;
  type: string;
  url: string;
  video?: any;
}

interface BraveVideos {
  mutated_by_goggles?: boolean;
  results: BraveResults[];
  type: string;
}

interface BraveWeb {
  family_friendly?: boolean;
  results: BraveResults[];
  type: string;
}

export interface BraveResponse {
  mixed: any;
  query?: any;
  type: string;
  videos?: BraveVideos;
  web: BraveWeb;
}
