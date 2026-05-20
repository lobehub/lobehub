import { getSourceEventScopeKey } from './scopeKey';
import type { AgentSignalSourcePayloadMap, AgentSignalSourceType } from './sourceTypes';

type AgentSignalSourceEventPayload<TSourceType extends AgentSignalSourceType> =
  AgentSignalSourcePayloadMap[TSourceType];

/**
 * Caller-provided data for one AgentSignal source event.
 *
 * @param TSourceType - Source type whose payload shape should be enforced.
 */
export interface AgentSignalSourceEventInput<
  TSourceType extends AgentSignalSourceType = AgentSignalSourceType,
> {
  /** Source-type-specific payload that describes what happened. */
  payload: AgentSignalSourceEventPayload<TSourceType>;
  /** Optional explicit scope key. Defaults to a key derived from payload routing fields. */
  scopeKey?: string;
  /** Stable producer event id used for dedupe. */
  sourceId: string;
  /** Source event type identifier. */
  sourceType: TSourceType;
  /** Optional event timestamp in milliseconds. Defaults to the current time. */
  timestamp?: number;
}

/**
 * Normalized AgentSignal source event ready for persistence, dedupe, or workflow handoff.
 *
 * @param TSourceType - Source type whose payload shape should be enforced.
 */
export interface AgentSignalSourceEvent<
  TSourceType extends AgentSignalSourceType = AgentSignalSourceType,
> extends Omit<AgentSignalSourceEventInput<TSourceType>, 'scopeKey' | 'timestamp'> {
  /** Stable scope key used to coordinate dedupe, workflow, and runtime lanes. */
  scopeKey: string;
  /** Event timestamp in milliseconds. */
  timestamp: number;
}

/**
 * Creates a normalized AgentSignal source event from caller input.
 *
 * Use when:
 * - Browser or server producers need the same event shape before handoff
 * - Callers want scope key and timestamp defaults without importing server services
 *
 * Expects:
 * - `sourceId` is stable for the producer event
 * - `payload` matches `sourceType`
 *
 * Returns:
 * - A source event with `scopeKey` and `timestamp` filled in
 */
export const createSourceEvent = <TSourceType extends AgentSignalSourceType>(
  input: AgentSignalSourceEventInput<TSourceType>,
): AgentSignalSourceEvent<TSourceType> => {
  return {
    payload: input.payload,
    scopeKey: input.scopeKey ?? getSourceEventScopeKey(input.payload),
    sourceId: input.sourceId,
    sourceType: input.sourceType,
    timestamp: input.timestamp ?? Date.now(),
  };
};
