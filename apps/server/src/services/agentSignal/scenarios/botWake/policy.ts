import { AGENT_SIGNAL_SOURCE_TYPES } from '@lobechat/agent-signal/source';

import { defineAgentSignalHandlers, defineSourceHandler } from '../../runtime/middleware';
import { aggregateWakeVerdictsAsync } from './aggregator';
import type { WakeDecision, WakePolicy, WakeSignal, WakeStateSnapshot } from './types';

export const EMPTY_WAKE_STATE: WakeStateSnapshot = {
  explicitMention: false,
  replyToBot: false,
  threadSubscribed: false,
};

export interface CreateBotWakePolicyOptions {
  /** Receives the aggregate decision; the orchestrator uses it to return the result synchronously. */
  onDecision?: (decision: WakeDecision) => void;
  policies?: readonly WakePolicy[];
  /** Resolves the state snapshot once per message. Defaults to an all-false snapshot. */
  resolveState?: (signal: WakeSignal) => Promise<WakeStateSnapshot> | WakeStateSnapshot;
}

/**
 * Installs the bot-wake evaluation on `bot.message.merged`.
 *
 * Use when:
 * - The bot-wake scenario runs; self-iteration policies are not installed alongside it
 *
 * Expects:
 * - Evaluation is side-effect free; the decision is only reported through `onDecision`
 */
export const createBotWakePolicy = (options: CreateBotWakePolicyOptions = {}) =>
  defineAgentSignalHandlers([
    defineSourceHandler(
      AGENT_SIGNAL_SOURCE_TYPES.botMessageMerged,
      'bot.message.merged:bot-wake-evaluate',
      async (source) => {
        const { agentId, applicationId, message, platform, platformThreadId } = source.payload;
        const signal: WakeSignal = {
          agentId,
          applicationId,
          message,
          platform,
          platformThreadId,
          timestamp: source.timestamp,
        };
        const snapshot = (await options.resolveState?.(signal)) ?? EMPTY_WAKE_STATE;

        options.onDecision?.(
          await aggregateWakeVerdictsAsync(options.policies ?? [], signal, snapshot),
        );
      },
    ),
  ]);
