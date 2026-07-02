import type { BaseAction, BaseSignal } from '@lobechat/agent-signal';
import { describe, expect, it } from 'vitest';

import {
  continueWith,
  noopResult,
  stop,
  transition,
  transitionToAction,
  transitionToSignals,
} from '../runtimeResults';

const signal = {
  chain: {
    rootSourceId: 'source-1',
  },
  payload: {
    domain: 'memory',
  },
  signalId: 'signal-1',
  signalType: 'plan.memory',
  source: {
    sourceId: 'source-1',
    sourceType: 'user.message',
  },
  timestamp: 1,
} satisfies BaseSignal;

const action = {
  actionId: 'action-1',
  actionType: 'memory.write',
  chain: {
    rootSourceId: 'source-1',
  },
  payload: {
    content: 'remember this',
  },
  signal: {
    signalId: signal.signalId,
    signalType: signal.signalType,
  },
  source: signal.source,
  timestamp: 2,
} satisfies BaseAction;

describe('runtimeResults', () => {
  /**
   * @example
   * continueWith('ok', { count: 1 }) returns a continue result with that value.
   */
  it('continues with a reason and value', () => {
    const result = continueWith('ok', { count: 1 });

    expect(result.value).toEqual({ count: 1 });
    expect(result).toEqual({
      reason: 'ok',
      type: 'continue',
      value: { count: 1 },
    });
  });

  /**
   * @example
   * continueWith('ok') returns a continue result without a value property.
   */
  it('continues without a value when no value is provided', () => {
    expect(continueWith('ok')).toEqual({
      reason: 'ok',
      type: 'continue',
    });
  });

  /**
   * @example
   * stop('no-op', noopResult('no-op')) returns a stop result with a conclusion payload.
   */
  it('stops with a runtime processor result', () => {
    expect(stop('no-op', noopResult('no-op'))).toEqual({
      reason: 'no-op',
      result: { concluded: { reason: 'no-op' }, status: 'conclude' },
      type: 'stop',
    });
  });

  /**
   * @example
   * stop('done') defaults to noopResult('done').
   */
  it('stops with a default no-op runtime processor result', () => {
    expect(stop('done')).toEqual({
      reason: 'done',
      result: { concluded: { reason: 'done' }, status: 'conclude' },
      type: 'stop',
    });
  });

  /**
   * @example
   * transition('dispatch later', result) returns a transition result with that runtime result.
   */
  it('transitions with a runtime processor result', () => {
    expect(transition('dispatch later', { signals: [signal], status: 'dispatch' })).toEqual({
      reason: 'dispatch later',
      result: { signals: [signal], status: 'dispatch' },
      type: 'transition',
    });
  });

  /**
   * @example
   * transitionToSignals([signal], { reason: 'domain fanout' }) dispatches the signal list.
   */
  it('transitions to signals for runtime dispatch', () => {
    expect(transitionToSignals([signal], { reason: 'domain fanout' })).toEqual({
      reason: 'domain fanout',
      result: { signals: [signal], status: 'dispatch' },
      type: 'transition',
    });
  });

  /**
   * @example
   * transitionToSignals(signal) normalizes one signal to a dispatch list.
   */
  it('transitions a single signal to a runtime dispatch list', () => {
    expect(transitionToSignals(signal)).toEqual({
      reason: 'dispatch signals',
      result: { signals: [signal], status: 'dispatch' },
      type: 'transition',
    });
  });

  /**
   * @example
   * transitionToSignals([]) stops with the default empty-signal reason.
   */
  it('stops empty signal dispatch with the default reason', () => {
    expect(transitionToSignals([])).toEqual({
      reason: 'no signals to dispatch',
      result: { concluded: { reason: 'no signals to dispatch' }, status: 'conclude' },
      type: 'stop',
    });
  });

  /**
   * @example
   * transitionToSignals([a, b], { maxSignals: 1 }) stops instead of dispatching fanout.
   */
  it('stops signal fanout that exceeds the configured budget', () => {
    const secondSignal = { ...signal, signalId: 'signal-2' } satisfies BaseSignal;

    expect(
      transitionToSignals([signal, secondSignal], {
        maxSignals: 1,
        reason: 'domain fanout',
      }),
    ).toEqual({
      reason: 'signal fanout budget exceeded',
      result: {
        concluded: {
          reason: 'signal fanout budget exceeded',
        },
        status: 'conclude',
      },
      type: 'stop',
    });
  });

  /**
   * @example
   * transitionToAction(action, { reason: 'plan memory' }) dispatches the action list.
   */
  it('transitions to actions for runtime dispatch', () => {
    expect(transitionToAction(action, { reason: 'plan memory' })).toEqual({
      reason: 'plan memory',
      result: { actions: [action], status: 'dispatch' },
      type: 'transition',
    });
  });

  /**
   * @example
   * transitionToAction(action) defaults to the action dispatch reason.
   */
  it('transitions actions with the default dispatch reason', () => {
    expect(transitionToAction(action)).toEqual({
      reason: 'dispatch actions',
      result: { actions: [action], status: 'dispatch' },
      type: 'transition',
    });
  });

  /**
   * @example
   * transitionToAction([]) stops with the default empty-action reason.
   */
  it('stops empty action dispatch with the default reason', () => {
    expect(transitionToAction([])).toEqual({
      reason: 'no actions to dispatch',
      result: { concluded: { reason: 'no actions to dispatch' }, status: 'conclude' },
      type: 'stop',
    });
  });
});
