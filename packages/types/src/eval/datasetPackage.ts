import type { EvalCaseEnvironment, EvalConnectorBindings, EvalTestCaseContent } from './agentEval';
import type { RubricType } from './rubric';

export type AgentEvalDatasetPackageEnvironment = Omit<EvalCaseEnvironment, 'connectorBindings'>;

export interface AgentEvalDatasetPackageConnection {
  credentials?:
    { token: string; type: 'bearer' } | { headers: Record<string, string>; type: 'header' };
  name: string;
  url: string;
}

export type AgentEvalDatasetPackageConnectionBindings = Record<
  string,
  { connectionKey: string; transport?: 'mcp' | 'lobe-bench' }
>;

export interface AgentEvalDatasetPackageBindings {
  caseBindings?: Record<string, EvalConnectorBindings>;
  environmentBindings?: Record<string, EvalConnectorBindings>;
}

export interface AgentEvalDatasetPackageConnectionRequirement {
  key: string;
  name: string;
  providedServices?: string[];
  scope: 'environment' | 'case';
  services: string[];
}

/** Editable installed targets. Keys are local environment/case IDs, not archive keys. */
export interface AgentEvalDatasetConnectorRequirement {
  bindings: EvalConnectorBindings;
  key: string;
  name: string;
  scope: 'environment' | 'case';
  services: string[];
}

/** Private packages may provision connections; installed IDs and ownership are never imported. */
export interface AgentEvalDatasetPackage {
  cases: Array<{
    connectionBindings?: AgentEvalDatasetPackageConnectionBindings;
    content: Omit<EvalTestCaseContent, 'environment'> & {
      environment?: AgentEvalDatasetPackageEnvironment;
    };
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
  connections?: Record<string, AgentEvalDatasetPackageConnection>;
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
    connectionBindings?: AgentEvalDatasetPackageConnectionBindings;
    config: AgentEvalDatasetPackageEnvironment;
    description?: string;
    key: string;
    name: string;
  }>;
  format: 'lobehub-eval-dataset';
  version: 1;
}

export interface AgentEvalDatasetPackagePreview {
  caseCount: number;
  connectionRequirements: AgentEvalDatasetPackageConnectionRequirement[];
  description?: string;
  embeddedConnections?: Array<{ authConfigured: boolean; key: string; name: string }>;
  environmentCount: number;
  mockServices: string[];
  name: string;
  release?: string;
  version: 1;
}
