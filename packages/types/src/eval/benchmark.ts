import { type AnswerExtractor, type EvalBenchmarkRubric } from './rubric';

// ============================================
// Benchmark Presets
// ============================================

export interface BenchmarkPresetPromptTemplate {
  system?: string;
  user: string;
}

export interface BenchmarkPreset {
  defaultRubrics: EvalBenchmarkRubric[];
  description: string;
  extractor: AnswerExtractor;
  fieldMapping: BenchmarkPresetFieldMapping;
  id: string;
  name: string;
  promptTemplate: BenchmarkPresetPromptTemplate;
}

export interface BenchmarkPresetFieldMapping {
  choices?: string;
  context?: string;
  expected: string;
  input: string;
  metadata?: Record<string, string>;
}

// ============================================
// Benchmark Entity Types
// ============================================

/**
 * Full benchmark entity (for detail pages)
 * Contains all fields including heavy data
 */
export interface AgentEvalBenchmark {
  createdAt: Date;
  description?: string | null;
  id: string;
  identifier: string;
  isSystem: boolean;
  metadata?: Record<string, unknown> | null;
  name: string;
  referenceUrl?: string | null;
  rubrics: EvalBenchmarkRubric[];
  updatedAt: Date;
}

/**
 * Lightweight benchmark item (for list display)
 * Excludes heavy fields, may include computed statistics
 */
export interface AgentEvalBenchmarkListItem {
  createdAt: Date;
  // Computed statistics for UI
  datasetCount?: number;
  description?: string | null;
  id: string;
  identifier: string;
  isSystem: boolean;

  name: string;
  runCount?: number;
  testCaseCount?: number;
}
