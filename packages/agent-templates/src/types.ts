/**
 * Load positions for Agent Documents in the context pipeline
 */
export enum DocumentLoadPosition {
  AFTER_FIRST_USER = 'after-first-user',
  AFTER_KNOWLEDGE = 'after-knowledge',
  BEFORE_FIRST_USER = 'before-first-user',
  BEFORE_KNOWLEDGE = 'before-knowledge',
  BEFORE_SYSTEM = 'before-system',
  CONTEXT_END = 'context-end',
  MANUAL = 'manual',
  ON_DEMAND = 'on-demand',
  SYSTEM_APPEND = 'system-append',
  SYSTEM_REPLACE = 'system-replace',
}

/**
 * Plain text agent documents are always loadable by default.
 */
export enum DocumentLoadRule {
  ALWAYS = 'always',
  BY_KEYWORDS = 'by-keywords',
  BY_REGEXP = 'by-regexp',
  BY_TIME_RANGE = 'by-time-range',
}

/**
 * Render format for injected agent document content.
 */
export enum DocumentLoadFormat {
  FILE = 'file',
  RAW = 'raw',
}

/**
 * Policy load behavior for injection pipeline.
 */
export enum PolicyLoad {
  ALWAYS = 'always',
  DISABLED = 'disabled',
}

/**
 * @deprecated use PolicyLoad.
 */
export const AutoLoadAccess = PolicyLoad;

/**
 * Agent capability bitmask.
 */
export enum AgentAccess {
  EXECUTE = 1,
  READ = 2,
  WRITE = 4,
  LIST = 8,
  DELETE = 16,
}

/**
 * Minimal load options for plain text documents.
 */
export interface DocumentLoadRules {
  keywordMatchMode?: 'all' | 'any';
  keywords?: string[];
  maxTokens?: number;
  priority?: number;
  regexp?: string;
  rule?: DocumentLoadRule;
  timeRange?: {
    from?: string;
    to?: string;
  };
}

/**
 * Behavior policy for runtime rendering/retrieval.
 * Extensible by design for future context/retrieval strategies.
 */
export interface AgentDocumentPolicy {
  [key: string]: any;
  context?: {
    keywordMatchMode?: 'all' | 'any';
    keywords?: string[];
    policyLoadFormat?: DocumentLoadFormat;
    maxTokens?: number;
    mode?: 'append' | 'replace';
    position?: DocumentLoadPosition;
    priority?: number;
    regexp?: string;
    rule?: DocumentLoadRule;
    timeRange?: {
      from?: string;
      to?: string;
    };
    [key: string]: any;
  };
  retrieval?: {
    importance?: number;
    recencyWeight?: number;
    searchPriority?: number;
    [key: string]: any;
  };
}
