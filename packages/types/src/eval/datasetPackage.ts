import type { EvalCaseEnvironment, EvalTestCaseContent } from './agentEval';
import type { RubricType } from './rubric';

/** Portable content only: database IDs, ownership and credentials are never imported. */
export interface AgentEvalDatasetPackage {
  cases: Array<{
    content: EvalTestCaseContent;
    environmentKey?: string;
    evalConfig?: Record<string, unknown>;
    evalMode?: RubricType;
    key: string;
    metadata?: {
      category?: string;
      difficulty?: 'easy' | 'hard' | 'medium';
      index?: number;
      tags?: string[];
    };
    sortOrder?: number;
  }>;
  dataset: {
    description?: string;
    evalConfig?: Record<string, unknown>;
    evalMode?: RubricType;
    metadata?: {
      mock?: {
        connectors?: Record<string, { avatar?: string; description?: string; title?: string }>;
        dataset: string;
      };
      presentation?: string;
      release?: string;
    };
    name: string;
  };
  environments: Array<{
    config: EvalCaseEnvironment;
    description?: string;
    key: string;
    name: string;
  }>;
  format: 'lobehub-eval-dataset';
  version: 1;
}

export interface AgentEvalDatasetPackagePreview {
  caseCount: number;
  description?: string;
  environmentCount: number;
  mockServices: string[];
  name: string;
  release?: string;
  version: 1;
}
