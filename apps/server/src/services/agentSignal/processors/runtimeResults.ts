import type { BaseAction, BaseSignal, RuntimeProcessorResult } from '@lobechat/agent-signal';

import type {
  RuntimeTransitionOptions,
  SignalProcessorContinueResult,
  SignalProcessorStopResult,
  SignalProcessorTransitionResult,
  SignalProcessorValuedContinueResult,
  SignalProcessorValuelessContinueResult,
} from './types';

/**
 * Creates a no-op conclusion result for runtime processors.
 *
 * Use when:
 * - A processor has nothing else to dispatch
 * - A stop result needs a consistent conclusion payload
 *
 * Expects:
 * - `reason` describes why the processor concluded
 *
 * Returns:
 * - A runtime conclusion result with the reason stored in `concluded.reason`
 */
export function noopResult(reason: string): RuntimeProcessorResult {
  return { concluded: { reason }, status: 'conclude' };
}

/**
 * Creates a processor result that lets local processing continue.
 *
 * Use when:
 * - A processor has produced a value for the next local step
 * - Runtime dispatch or conclusion is not needed yet
 *
 * Expects:
 * - `reason` describes the continue decision
 * - `value` is safe for the next processor step to consume
 *
 * Returns:
 * - A continue result carrying the value when one is provided
 */
export function continueWith(reason: string): SignalProcessorValuelessContinueResult;
export function continueWith<TValue>(
  reason: string,
  value: TValue,
): SignalProcessorValuedContinueResult<TValue>;
export function continueWith<TValue>(
  reason: string,
  value?: TValue,
): SignalProcessorContinueResult<TValue> {
  if (arguments.length === 1) {
    return { reason, type: 'continue' };
  }

  return { reason, type: 'continue', value };
}

/**
 * Creates a processor result that stops local processing.
 *
 * Use when:
 * - A processor has reached a terminal local state
 * - A runtime conclusion, wait, schedule, or dispatch result should be returned immediately
 *
 * Expects:
 * - `reason` describes the stop decision
 * - `result` is the runtime result the host should consume
 *
 * Returns:
 * - A stop result with a no-op conclusion by default
 */
export function stop(
  reason: string,
  result: RuntimeProcessorResult = noopResult(reason),
): SignalProcessorStopResult {
  return { reason, result, type: 'stop' };
}

/**
 * Creates a processor result that transitions through the runtime host.
 *
 * Use when:
 * - A processor needs the runtime host to dispatch, wait, schedule, or conclude
 * - The caller wants to distinguish transition from terminal stop semantics
 *
 * Expects:
 * - `reason` describes the transition decision
 * - `result` is the runtime result the host should consume
 *
 * Returns:
 * - A transition result carrying the runtime processor result
 */
export function transition(
  reason: string,
  result: RuntimeProcessorResult,
): SignalProcessorTransitionResult {
  return { reason, result, type: 'transition' };
}

/**
 * Creates a transition result that dispatches one or more signals.
 *
 * Use when:
 * - A processor fans out from one signal domain to more signals
 * - The runtime host should continue by dispatching signal handlers
 *
 * Expects:
 * - `signalOrSignals` is either one signal or a prebuilt signal list
 * - Empty arrays indicate there is nothing to dispatch
 *
 * Returns:
 * - A dispatch transition when signals exist, otherwise a stop result
 */
export function transitionToSignals(
  signalOrSignals: BaseSignal,
  options?: RuntimeTransitionOptions,
): SignalProcessorTransitionResult;
export function transitionToSignals(
  signalOrSignals: BaseSignal[],
  options?: RuntimeTransitionOptions,
): SignalProcessorStopResult | SignalProcessorTransitionResult;
export function transitionToSignals(
  signalOrSignals: BaseSignal | BaseSignal[],
  options: RuntimeTransitionOptions = {},
): SignalProcessorStopResult | SignalProcessorTransitionResult {
  const signals = Array.isArray(signalOrSignals) ? signalOrSignals : [signalOrSignals];

  if (signals.length === 0) {
    return stop(options.reason ?? 'no signals to dispatch');
  }

  if (typeof options.maxSignals === 'number' && signals.length > options.maxSignals) {
    return stop('signal fanout budget exceeded');
  }

  return transition(options.reason ?? 'dispatch signals', { signals, status: 'dispatch' });
}

/**
 * Creates a transition result that dispatches one or more actions.
 *
 * Use when:
 * - A processor converts planned work into executable actions
 * - The runtime host should continue by dispatching action handlers
 *
 * Expects:
 * - `actionOrActions` is either one action or a prebuilt action list
 * - Empty arrays indicate there is nothing to dispatch
 *
 * Returns:
 * - A dispatch transition when actions exist, otherwise a stop result
 */
export function transitionToAction(
  actionOrActions: BaseAction,
  options?: RuntimeTransitionOptions,
): SignalProcessorTransitionResult;
export function transitionToAction(
  actionOrActions: BaseAction[],
  options?: RuntimeTransitionOptions,
): SignalProcessorStopResult | SignalProcessorTransitionResult;
export function transitionToAction(
  actionOrActions: BaseAction | BaseAction[],
  options: RuntimeTransitionOptions = {},
): SignalProcessorStopResult | SignalProcessorTransitionResult {
  const actions = Array.isArray(actionOrActions) ? actionOrActions : [actionOrActions];

  if (actions.length === 0) {
    return stop(options.reason ?? 'no actions to dispatch');
  }

  return transition(options.reason ?? 'dispatch actions', { actions, status: 'dispatch' });
}
