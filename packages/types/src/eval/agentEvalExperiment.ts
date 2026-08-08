import type { AgentEvalDatasetListItem } from './agentEvalDataset';
import type { AgentEvalRunListItem } from './agentEvalRun';

// ============================================
// Experiment Entity Types
// ============================================

/**
 * Lightweight benchmark reference embedded in an experiment
 */
export interface AgentEvalExperimentBenchmark {
  description?: string | null;
  id: string;
  identifier?: string;
  isSystem?: boolean;
  name: string;
}

/**
 * Full experiment entity.
 * An experiment groups several benchmarks into one workspace; it owns
 * scoped datasets (subsets/forks) and runs.
 */
export interface AgentEvalExperiment {
  accessedAt: Date;
  benchmarks: AgentEvalExperimentBenchmark[];
  createdAt: Date;
  description?: string | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  name: string;
  updatedAt: Date;
  userId: string;
}

/**
 * Lightweight experiment item (for list / overview display)
 * Adds aggregate counts and a small recent-runs preview.
 */
export interface AgentEvalExperimentListItem extends AgentEvalExperiment {
  benchmarkCount: number;
  datasetCount: number;
  recentRuns?: AgentEvalRunListItem[];
  runCount: number;
}

/**
 * Single-payload experiment detail: everything the workspace page needs in
 * one query. `datasets` contains ALL datasets across the linked benchmarks —
 * baseline datasets (`sourceExperimentId` null / different) and experiment
 * scoped subsets (`sourceExperimentId === id`) — so the client can group and
 * split without a second fetch. `runs` are the experiment-scoped runs.
 */
export interface AgentEvalExperimentDetail extends AgentEvalExperiment {
  datasets: AgentEvalDatasetListItem[];
  runs: AgentEvalRunListItem[];
}
