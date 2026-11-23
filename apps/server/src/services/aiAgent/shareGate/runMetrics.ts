import {
  agentShareRunCounter,
  type AgentShareRunOutcome,
  type AgentShareRunStage,
} from '@lobechat/observability-otel/modules/agent-share';
import { AgentRuntimeErrorType, ChatErrorType } from '@lobechat/types';

/**
 * `ChatErrorType` also carries HTTP status codes (`401`, `500`, ...), compared as strings. The
 * run caps type a capped run that stopped without a reply.
 */
const KNOWN_ERROR_TYPES = new Set<string>([
  ...[...Object.values(ChatErrorType), ...Object.values(AgentRuntimeErrorType)].map(String),
  'cost_limit',
  'max_steps',
  'tool_call_repeat_limit',
]);

const KNOWN_ATTRIBUTIONS = new Set(['harness', 'provider', 'system', 'user']);

/**
 * Keep `error_type` a closed set: an error type is free text on some paths (a provider's own
 * code, a thrown message), and one unbounded value is enough to blow up the series count.
 */
export const normalizeShareRunErrorType = (type: unknown): string => {
  if (type === undefined || type === null || type === '') return 'Unknown';
  const value = String(type);
  return KNOWN_ERROR_TYPES.has(value) ? value : 'Other';
};

export interface ShareRunResult {
  attribution?: string;
  errorType?: unknown;
  outcome: AgentShareRunOutcome;
  stage: AgentShareRunStage;
}

/**
 * Count one terminal shared Agent run. Never throws: telemetry must not change how a run ends.
 */
export const recordShareRunResult = ({
  attribution,
  errorType,
  outcome,
  stage,
}: ShareRunResult) => {
  try {
    const success = outcome === 'success';
    agentShareRunCounter.add(1, {
      error_attribution:
        !success && attribution && KNOWN_ATTRIBUTIONS.has(attribution) ? attribution : 'none',
      error_type: success ? 'none' : normalizeShareRunErrorType(errorType),
      outcome,
      stage,
    });
  } catch (error) {
    console.error('[agentShare:runMetrics] failed to record a share run result', error);
  }
};
