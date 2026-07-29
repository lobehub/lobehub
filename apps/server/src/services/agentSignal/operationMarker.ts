/**
 * Run-scoped marker stamped onto an agent operation's `metadata.agentSignal` at
 * dispatch, and read back at tool-call time / completion time.
 *
 * The `agent.execution.completed` source payload only carries
 * `agentId / operationId / topicId`. Async self-iteration & memory tools need
 * more: the originating source id, the review window / local date (for evidence
 * re-derivation and brief/receipt writes), and optional message ids for receipt
 * projection. `triggerMessageId` is the causal source. `anchorMessageId` is an
 * explicit display anchor and should only point at a known assistant message.
 * Rather than a side channel, this travels on the operation row itself.
 */

import type { AgentSignalOperationKind, AgentSignalOperationMarker } from '@lobechat/types';

// The marker shape is defined in `@lobechat/types` (so `ExecAgentAppContext` can
// carry it through `execAgent`); the runtime parser/validator helpers live here.
export type { AgentSignalOperationKind, AgentSignalOperationMarker };

const VALID_KINDS = new Set<AgentSignalOperationKind>([
  'memory',
  'nightly-review',
  'self-feedback-intent',
  'self-reflection',
  'skill',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * Reads the agent-signal marker from an operation `metadata` object. Returns
 * `undefined` when the operation was not an agent-signal run.
 */
export const readAgentSignalMarker = (
  metadata: unknown,
): AgentSignalOperationMarker | undefined => {
  if (!isRecord(metadata)) return undefined;
  const marker = metadata.agentSignal;
  if (!isRecord(marker)) return undefined;

  const kind = marker.kind;
  if (typeof kind !== 'string' || !VALID_KINDS.has(kind as AgentSignalOperationKind)) {
    return undefined;
  }

  return {
    kind: kind as AgentSignalOperationKind,
    ...(str(marker.anchorMessageId) ? { anchorMessageId: str(marker.anchorMessageId) } : {}),
    ...(str(marker.localDate) ? { localDate: str(marker.localDate) } : {}),
    ...(str(marker.reviewWindowEnd) ? { reviewWindowEnd: str(marker.reviewWindowEnd) } : {}),
    ...(str(marker.reviewWindowStart) ? { reviewWindowStart: str(marker.reviewWindowStart) } : {}),
    ...(str(marker.sourceId) ? { sourceId: str(marker.sourceId) } : {}),
    ...(str(marker.topicId) ? { topicId: str(marker.topicId) } : {}),
    ...(str(marker.triggerMessageId) ? { triggerMessageId: str(marker.triggerMessageId) } : {}),
  };
};

/** Build the `appContext.agentSignal` value to stamp at dispatch time. */
export const buildAgentSignalMarker = (
  marker: AgentSignalOperationMarker,
): AgentSignalOperationMarker => marker;

export const isAgentSignalKind = (value: unknown): value is AgentSignalOperationKind =>
  typeof value === 'string' && VALID_KINDS.has(value as AgentSignalOperationKind);
