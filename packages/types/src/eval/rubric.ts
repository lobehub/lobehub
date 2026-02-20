// ============================================
// Rubric Types & Configs
// ============================================

export type RubricType =
  // Deterministic matching
  | 'equals'
  | 'contains'
  | 'regex'
  | 'starts-with'
  | 'ends-with'
  | 'any-of'
  | 'numeric'
  | 'extract-match'
  | 'json-schema'
  | 'javascript'
  | 'python'
  // LLM scoring
  | 'llm-rubric'
  | 'factuality'
  | 'answer-relevance'
  // Similarity
  | 'similar'
  | 'levenshtein'
  // Composite
  | 'rubric';

export interface RubricConfigValue {
  value: string;
}

export interface RubricConfigRegex {
  pattern: string;
}

export interface RubricConfigJsonSchema {
  schema: Record<string, unknown>;
}

export interface RubricConfigScript {
  code: string;
}

export interface RubricConfigLLM {
  criteria: string;
  model?: string;
  provider?: string;
  systemRole?: string;
}

export interface RubricConfigSimilarity {
  threshold?: number;
  value: string;
}

export interface RubricConfigAnyOf {
  caseSensitive?: boolean;
  values: string[];
}

export interface RubricConfigNumeric {
  tolerance?: number;
  value: number;
}

export interface RubricConfigExtractMatch {
  extractor: AnswerExtractor;
  innerMatcher?: RubricType;
}

export type RubricConfig =
  | RubricConfigAnyOf
  | RubricConfigExtractMatch
  | RubricConfigJsonSchema
  | RubricConfigLLM
  | RubricConfigNumeric
  | RubricConfigRegex
  | RubricConfigScript
  | RubricConfigSimilarity
  | RubricConfigValue;

export interface EvalBenchmarkRubric {
  config: RubricConfig;
  extractor?: AnswerExtractor;
  id: string;
  name: string;
  threshold?: number;
  type: RubricType;
  weight: number;
}

// ============================================
// Answer Extractors
// ============================================

export type AnswerExtractorType = 'choice-index' | 'delimiter' | 'last-line' | 'regex';

export interface AnswerExtractorRegex {
  group?: number;
  pattern: string;
  type: 'regex';
}

export interface AnswerExtractorDelimiter {
  delimiter: string;
  position?: 'first' | 'last';
  type: 'delimiter';
}

export interface AnswerExtractorLastLine {
  trim?: boolean;
  type: 'last-line';
}

export interface AnswerExtractorChoiceIndex {
  labels?: string[];
  pattern?: string;
  type: 'choice-index';
}

export type AnswerExtractor =
  | AnswerExtractorChoiceIndex
  | AnswerExtractorDelimiter
  | AnswerExtractorLastLine
  | AnswerExtractorRegex;
