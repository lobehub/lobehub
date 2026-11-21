export const SkillStoreIdentifier = 'lobe-skill-store';

export const SkillStoreApiName = {
  importFromMarket: 'importFromMarket',
  importSkill: 'importSkill',
  inspectSkill: 'inspectSkill',
  searchSkill: 'searchSkill',
};

export interface ImportSkillParams {
  type: 'url' | 'zip';
  url: string;
}

export interface ImportSkillState {
  name?: string;
  skillId?: string;
  status: 'created' | 'updated' | 'unchanged';
  success: boolean;
}

export interface SearchSkillParams {
  /**
   * Locale for search results (e.g., 'en-US', 'zh-CN')
   */
  locale?: string;
  /**
   * Sort order: 'asc' or 'desc'
   */
  order?: 'asc' | 'desc';
  /**
   * Page number (default: 1)
   */
  page?: number;
  /**
   * Page size (default: 20)
   */
  pageSize?: number;
  /**
   * Search query (searches name, description, summary)
   */
  q?: string;
  /**
   * Sort field: createdAt | installCount | forks | name | relevance | stars | updatedAt | watchers
   */
  sort?:
    | 'createdAt'
    | 'forks'
    | 'installCount'
    | 'name'
    | 'relevance'
    | 'stars'
    | 'updatedAt'
    | 'watchers';
}

export interface MarketSkillItem {
  category?: string;
  createdAt: string;
  description: string;
  identifier: string;
  installCount: number;
  name: string;
  repository?: string;
  sourceUrl?: string;
  summary?: string;
  updatedAt: string;
  version?: string;
}

export interface SearchSkillState {
  items: MarketSkillItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ImportFromMarketParams {
  /**
   * The identifier of the skill to import from market
   */
  identifier: string;
}

export interface ImportFromMarketState {
  name?: string;
  skillId?: string;
  status: 'created' | 'updated' | 'unchanged';
  success: boolean;
}

export interface InspectSkillParams {
  /**
   * The identifier of the market skill to check before installing it
   */
  identifier: string;
}

/** One text file of a skill package, path relative to the package root. */
export interface SkillPackageFile {
  content: string;
  path: string;
}

/**
 * - `required`: the script fails without it (`os.environ["X"]`, `ENV.fetch("X")`, `${X:?}`),
 *   or its docs say it is needed
 * - `one_of`: read in a fallback chain with no usable default, any one variable is enough
 * - `optional`: has a non-empty default, or its docs say it is not needed
 * - `unknown`: read with no default and nothing shows what happens when it is unset
 */
export type SkillEnvRequirement = 'one_of' | 'optional' | 'required' | 'unknown';

/** An environment variable a skill reads or tells the user to set, and where. */
export interface SkillEnvVarUsage {
  /** Variables that can stand in for this one (`one_of`), in the script's fallback order */
  alternatives: string[];
  /**
   * The fallback value. `null` when there is none, or when it is not a literal in
   * the file. A credential's default is always `[redacted]`.
   */
  defaultValue: string | null;
  files: string[];
  hasDefault: boolean;
  name: string;
  requirement: SkillEnvRequirement;
}

/** A network host a skill's scripts contact, and where it appears. */
export interface SkillEndpointUsage {
  files: string[];
  host: string;
}

export type SkillEgressContentType = 'audio' | 'file' | 'image' | 'text' | 'unknown' | 'video';

/** The code that shows a script sends a kind of content. */
export interface SkillEgressSignal {
  contentType: Exclude<SkillEgressContentType, 'unknown'>;
  file: string;
  signal: string;
}

export interface SkillDataEgress {
  /** Settings that can change the destination (base URL, endpoint, host) */
  configurableVia: string[];
  /** What is sent. `unknown` when data leaves but the kind cannot be told; empty when none leaves */
  contentTypes: SkillEgressContentType[];
  /** True when a script names an external host or reads a destination setting */
  occurs: boolean;
  signals: SkillEgressSignal[];
  /** External hosts written in the scripts */
  targets: string[];
}

/**
 * What a skill needs, read from its own files rather than its author-written
 * description: a description can claim "no API key needed" while the scripts
 * read one and send data to a third-party API.
 */
export interface SkillRequirements {
  /** Every credential variable found, including optional ones */
  apiKeyNames: string[];
  /** Credential-like environment variables (API keys, tokens, secrets) */
  credentials: SkillEnvVarUsage[];
  /** Whether the skill sends data out, where to, and what kind */
  dataEgress: SkillDataEgress;
  /** Network hosts referenced in the skill's scripts */
  endpoints: SkillEndpointUsage[];
  /** True unless no credential was found or every one found is `optional` */
  requiresApiKey: boolean;
  /** Executable script files in the package */
  scripts: string[];
  /** Other environment variables the scripts read (base URLs, model names, …) */
  settings: SkillEnvVarUsage[];
}

export interface InspectSkillState extends SkillRequirements {
  identifier: string;
  name?: string;
}
