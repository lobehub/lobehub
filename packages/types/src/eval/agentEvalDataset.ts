import type { EvalConfig, EvalMode } from './agentEval';

// ============================================
// Dataset Entity Types
// ============================================

/**
 * Full dataset entity (for detail pages)
 * Contains all fields including heavy data
 */
export interface AgentEvalDataset {
  benchmarkId: string;
  createdAt: Date;
  description?: string | null;
  evalConfig?: EvalConfig | null;
  evalMode?: EvalMode | null;
  id: string;
  identifier: string;
  metadata?: Record<string, unknown> | null;
  name: string;
  updatedAt: Date;
  userId?: string | null;
}

/**
 * Lightweight dataset item (for list display)
 * Excludes heavy fields, may include computed statistics
 */
export interface AgentEvalDatasetListItem {
  benchmarkId: string;
  createdAt: Date;
  description?: string | null;
  evalConfig?: EvalConfig | null;
  evalMode?: EvalMode | null;
  id: string;
  identifier: string;
  metadata?: Record<string, unknown> | null;
  name: string;
  /**
   * Set when this dataset is an experiment-scoped subset/fork.
   * Null/undefined = baseline benchmark dataset.
   */
  sourceExperimentId?: string | null;
  // Computed statistics for UI
  testCaseCount?: number;
  updatedAt: Date;

  userId?: string | null;
}
