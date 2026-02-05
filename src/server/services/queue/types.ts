import type {AgentRuntimeContext} from '@lobechat/agent-runtime';

export interface QueueMessage {
  context?: AgentRuntimeContext;
  delay?: number;
  endpoint: string;
  operationId: string;
  payload?: any;
  priority?: 'high' | 'normal' | 'low';
  retries?: number;
  stepIndex: number;
}

export interface QueueStats {
  completedCount: number;
  failedCount: number;
  pendingCount: number;
  processingCount: number;
}

export interface HealthCheckResult {
  healthy: boolean;
  message?: string;
}
