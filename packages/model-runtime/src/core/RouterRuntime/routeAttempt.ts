import type { ModelPerformance, ModelUsage } from '@lobechat/types';

import type { ModelRuntimeDiagnostics } from '../../types/providerDiagnostics';

export interface RouteAttemptResult {
  apiType: string;
  attemptId?: string;
  channelId?: string;
  completionPending?: boolean;
  durationMs: number;
  error?: unknown;
  metadata?: Record<string, unknown>;
  model: string;
  nonRetryable?: boolean;
  nonRetryableReason?: 'imageDecode';
  optionIndex: number;
  providerId: string;
  remark?: string;
  requestId?: string;
  /** A request-scoped task owns this attempt's asynchronous reporting. */
  routeRequestManaged?: boolean;
  routerId?: string;
  startedAt?: number;
  success: boolean;
  userId?: string;
}

export interface RouteAttemptStart extends Omit<
  RouteAttemptResult,
  'completionPending' | 'durationMs' | 'success'
> {
  attemptId: string;
  requestId: string;
  startedAt: number;
}

export type RouteAttemptOutcome = 'completed' | 'empty' | 'interrupted' | 'cancelled' | 'failed';

export interface RouteAttemptFinished extends RouteAttemptResult {
  attemptId: string;
  completedAt: number;
  diagnostics: ModelRuntimeDiagnostics;
  outcome: RouteAttemptOutcome;
  requestId: string;
  speed?: ModelPerformance;
  startedAt: number;
  streaming: boolean;
  usage?: ModelUsage;
}
