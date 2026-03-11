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
  name: string;
  // Computed statistics for UI
  testCaseCount?: number;
  updatedAt: Date;

  userId?: string | null;
}
