import type {
  AgentSignalSourcePayloadMap,
  AgentSignalSourceType,
} from '@lobechat/agent-signal/source';

import { agentSignalService } from '@/services/agentSignal';
import { labPreferSelectors } from '@/store/user/selectors';
import { getUserStoreState } from '@/store/user/store';

type ClientAgentSignalSourceType = Extract<AgentSignalSourceType, `client.${string}`>;

type ClientAgentSignalSourcePayload<TSourceType extends ClientAgentSignalSourceType> =
  AgentSignalSourcePayloadMap[TSourceType];

export interface ClientAgentSignalSourceEvent<TSourceType extends ClientAgentSignalSourceType> {
  payload: ClientAgentSignalSourcePayload<TSourceType>;
  scopeKey?: string;
  sourceId?: string;
  sourceType: TSourceType;
  timestamp?: number;
}

const createSourceId = (sourceType: string, timestamp: number) => {
  return `${sourceType}:${timestamp}:${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * Skips the round trip once the user state says Labs → Self-evolving is off. Before the user
 * state loads, the event is sent and the server gate decides.
 */
const shouldEmitClientAgentSignalSourceEvent = () => {
  const userState = getUserStoreState();

  if (userState?.isUserStateInit && !labPreferSelectors.enableSelfLearning(userState)) {
    return false;
  }

  return true;
};

/**
 * Emits a client-side source event to the server-owned AgentSignal pipeline.
 *
 * Use when:
 * - Browser/runtime code observes a meaningful boundary but must not run policies locally
 * - The event should be normalized through the same server-side dedupe/backpressure layer
 *
 * Expects:
 * - Payload contains enough routing context (topic or bot thread identifiers)
 * - Failures must never block the UI path
 *
 * @returns Server mutation result when available, otherwise `undefined`
 */
export const emitClientAgentSignalSourceEvent = async <
  TSourceType extends ClientAgentSignalSourceType,
>(
  input: ClientAgentSignalSourceEvent<TSourceType>,
) => {
  if (!shouldEmitClientAgentSignalSourceEvent()) return undefined;

  const timestamp = input.timestamp ?? Date.now();

  try {
    return await agentSignalService.emitClientGatewaySourceEvent({
      payload: input.payload,
      scopeKey: input.scopeKey,
      sourceId: input.sourceId ?? createSourceId(input.sourceType, timestamp),
      sourceType: input.sourceType,
      timestamp,
    });
  } catch (error) {
    console.error('[AgentSignal] Failed to emit client source event:', error);
    return undefined;
  }
};
