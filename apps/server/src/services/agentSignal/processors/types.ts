import type { RuntimeProcessorResult } from '@lobechat/agent-signal';

/**
 * Represents a continue decision without a local value.
 */
export interface SignalProcessorValuelessContinueResult {
  /**
   * Stable reason used for tracing, metrics, and tests.
   */
  reason: string;
  /**
   * Discriminates local continue decisions from runtime stop or transition decisions.
   */
  type: 'continue';
}

/**
 * Represents a continue decision with a local value.
 *
 * @param TValue - Value shape produced for the next local processor step.
 */
export interface SignalProcessorValuedContinueResult<TValue> {
  /**
   * Stable reason used for tracing, metrics, and tests.
   */
  reason: string;
  /**
   * Discriminates local continue decisions from runtime stop or transition decisions.
   */
  type: 'continue';
  /**
   * Value produced for the next local processor step.
   */
  value: TValue;
}

/**
 * Represents any continue decision before the runtime host consumes it.
 *
 * @param TValue - Optional value shape produced for the next local processor step.
 */
export type SignalProcessorContinueResult<TValue = unknown> =
  | SignalProcessorValuedContinueResult<TValue>
  | SignalProcessorValuelessContinueResult;

/**
 * Represents a processor decision that stops local processing.
 */
export interface SignalProcessorStopResult {
  /**
   * Stable reason used for tracing, metrics, and tests.
   */
  reason: string;
  /**
   * Runtime result the host should consume.
   */
  result: RuntimeProcessorResult;
  /**
   * Discriminates terminal stop decisions from continue and transition decisions.
   */
  type: 'stop';
}

/**
 * Represents a processor decision that transitions through the runtime host.
 */
export interface SignalProcessorTransitionResult {
  /**
   * Stable reason used for tracing, metrics, and tests.
   */
  reason: string;
  /**
   * Runtime result the host should consume.
   */
  result: RuntimeProcessorResult;
  /**
   * Discriminates runtime transition decisions from continue and stop decisions.
   */
  type: 'transition';
}

/**
 * Represents a processor decision before the runtime host consumes it.
 *
 * Use when:
 * - A signal processor needs to keep local processing going with a typed value
 * - A signal processor needs to stop or transition through a runtime result
 *
 * Expects:
 * - `reason` is stable enough for logs, metrics, and tests
 * - `result` is provided whenever the runtime host must perform a terminal or dispatch action
 *
 * Returns:
 * - A discriminated union keyed by `type`
 */
export type SignalProcessorResult<TValue = unknown> =
  | SignalProcessorContinueResult<TValue>
  | SignalProcessorStopResult
  | SignalProcessorTransitionResult;

/**
 * Options shared by helpers that create runtime transition results.
 */
export interface RuntimeTransitionOptions {
  /**
   * Maximum number of signals a transition may dispatch.
   *
   * @default undefined, meaning no local helper limit. Callers that perform domain fanout should
   * set this explicitly from their per-source or per-chain budget.
   */
  maxSignals?: number;
  /**
   * Optional reason used for tracing the transition decision.
   *
   * @default Helper-specific reason. Signal dispatch defaults to `dispatch signals` or
   * `no signals to dispatch`; action dispatch defaults to `dispatch actions` or
   * `no actions to dispatch`.
   */
  reason?: string;
}
