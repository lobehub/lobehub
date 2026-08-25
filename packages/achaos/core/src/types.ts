export type ChaosLayer =
  | 'L0-infra'
  | 'L1-model-runtime'
  | 'L2-agent-runtime'
  | 'L3-orchestration'
  | 'L4-business-logic'
  | 'L5-human-trust';

export type ChaosEffect =
  | { durationMs: number; type: 'delay' }
  | { count: number; type: 'duplicate' }
  | { type: 'drop' }
  | { errorType: string; message?: string; type: 'throw' }
  | { content: string; type: 'replace_result' }
  | { signal?: 'SIGKILL'; type: 'kill_process' };

export interface ChaosTarget {
  adapter: string;
  selector: Record<string, unknown>;
}

export interface ChaosTrigger {
  probability?: number;
  when: 'immediate' | 'before' | 'after';
}

export interface ChaosOracleSpec {
  name: string;
  params?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface ChaosSafetyPolicy {
  allowedEnvironments: string[];
  destructive?: boolean;
  maxInjections?: number;
}

export interface ChaosExperiment {
  cleanup?: 'always' | 'on_success' | 'never';
  description: string;
  discoveredFrom?: string;
  effect: ChaosEffect;
  id: string;
  layer: ChaosLayer;
  oracles: ChaosOracleSpec[];
  safety: ChaosSafetyPolicy;
  seed: string;
  tags?: string[];
  target: ChaosTarget;
  timeoutMs: number;
  trigger: ChaosTrigger;
}

export type ChaosRunStatus = 'passed' | 'failed' | 'inconclusive' | 'aborted';

export type ChaosJsonValue =
  boolean | null | number | string | ChaosJsonValue[] | { [key: string]: ChaosJsonValue };

export type ChaosTimelineEventType =
  | 'run_started'
  | 'steady_state_checked'
  | 'fault_injected'
  | 'system_exercised'
  | 'oracle_evaluated'
  | 'cleanup_started'
  | 'cleanup_completed'
  | 'run_completed';

export interface ChaosTimelineEvent {
  at: string;
  data?: Record<string, unknown>;
  type: ChaosTimelineEventType;
}

export interface ChaosEvidenceRef {
  id: string;
  type: 'trace' | 'operation' | 'snapshot' | 'log' | 'artifact';
}

export interface ChaosOracleResult {
  evidence?: ChaosEvidenceRef[];
  message: string;
  name: string;
  status: 'passed' | 'failed' | 'inconclusive';
}

export interface ChaosInjectionReceipt {
  adapter: string;
  cleanupToken?: Record<string, unknown>;
  details?: Record<string, ChaosJsonValue>;
  injectionId: string;
}

export interface ChaosRunResult {
  durationMs: number;
  error?: { message: string; name: string };
  experimentId: string;
  finishedAt: string;
  injection?: Omit<ChaosInjectionReceipt, 'cleanupToken'>;
  oracleResults: ChaosOracleResult[];
  runId: string;
  seed: string;
  startedAt: string;
  status: ChaosRunStatus;
  timeline: ChaosTimelineEvent[];
}

export interface ChaosRunContext {
  environment: string;
  experiment: ChaosExperiment;
  random: () => number;
  runId: string;
  signal: AbortSignal;
}

export interface ChaosAdapter {
  /**
   * Cancels an in-flight injection before it yields a receipt. Required whenever cleanup is
   * provided; resolving guarantees that the pending injection cannot commit later.
   */
  cancelInjection?: (context: ChaosRunContext) => Promise<void>;
  cleanup?: (receipt: ChaosInjectionReceipt, context: ChaosRunContext) => Promise<void>;
  inject: (context: ChaosRunContext) => Promise<ChaosInjectionReceipt>;
  name: string;
  verifyInjection?: (receipt: ChaosInjectionReceipt, context: ChaosRunContext) => Promise<boolean>;
}

export interface ChaosOracle {
  evaluate: (context: ChaosRunContext, spec: ChaosOracleSpec) => Promise<ChaosOracleResult>;
  name: string;
}

export interface ChaosExercise {
  (context: ChaosRunContext): Promise<void>;
}
