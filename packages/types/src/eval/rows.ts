import type {
  EvalCaseEnvironment,
  EvalConfig,
  EvalMode,
  EvalTestCaseContent,
  EvalTestCaseMetadata,
} from './agentEval';

/** Persisted case input; omitted nullable fields use their database defaults. */
export interface AgentEvalTestCaseInsert {
  accessedAt?: Date;
  content: EvalTestCaseContent;
  createdAt?: Date;
  datasetId: string;
  environmentId?: string | null;
  evalConfig?: EvalConfig | null;
  evalMode?: EvalMode | null;
  id?: string;
  metadata?: EvalTestCaseMetadata | null;
  sortOrder?: number | null;
  updatedAt?: Date;
  userId?: string | null;
  workspaceId?: string | null;
}

/** Persisted reusable environment input, shared by models and import services. */
export interface AgentEvalEnvironmentInsert {
  accessedAt?: Date;
  config: EvalCaseEnvironment;
  createdAt?: Date;
  description?: string | null;
  id?: string;
  identifier?: string | null;
  metadata?: Record<string, unknown> | null;
  name: string;
  updatedAt?: Date;
  userId?: string | null;
  workspaceId?: string | null;
}
