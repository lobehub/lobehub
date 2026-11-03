import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';

import type { HeterogeneousAgentEvent } from '../types';

/**
 * Stamp an `operationId` onto an adapter-emitted `HeterogeneousAgentEvent` to
 * produce an `AgentStreamEvent` — the wire shape the gateway handler and the
 * server's `StreamEventManager.publish` both consume. Producer-side conversion
 * keeps consumer code (renderer, server handler) free of any adapter awareness.
 */
export const toStreamEvent = (
  event: HeterogeneousAgentEvent,
  operationId: string,
): AgentStreamEvent => ({
  data: event.data,
  operationId,
  stepIndex: event.stepIndex,
  timestamp: event.timestamp,
  type: event.type,
});
