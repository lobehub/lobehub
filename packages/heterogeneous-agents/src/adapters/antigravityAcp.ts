import { isRecord } from '@lobechat/utils/object';

import { classifyCliMessageError } from '../errors/classifyCliMessageError';
import type { HeterogeneousAgentEvent, UsageData } from '../types';
import { TraeAcpAdapter } from './traeAcp';

const IDENTIFIER = 'antigravity';

const tokenCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

/**
 * `agy acp` reports `inputTokens` without cache reads (`totalTokens` is input
 * + cached reads + output), unlike the ACP usage shape the base adapter
 * assumes. Our totals include cached input.
 */
const toAntigravityUsage = (raw: unknown): UsageData | undefined => {
  if (!isRecord(raw)) return;
  const inputCacheMissTokens = tokenCount(raw.inputTokens);
  const inputCachedTokens = tokenCount(raw.cachedReadTokens);
  const totalOutputTokens = tokenCount(raw.outputTokens);
  if (!inputCacheMissTokens && !inputCachedTokens && !totalOutputTokens) return;
  const outputReasoningTokens = Math.min(tokenCount(raw.thoughtTokens), totalOutputTokens);
  const totalInputTokens = inputCacheMissTokens + inputCachedTokens;
  return {
    inputCachedTokens: inputCachedTokens || undefined,
    inputCacheMissTokens,
    outputReasoningTokens: outputReasoningTokens || undefined,
    outputTextTokens: totalOutputTokens - outputReasoningTokens,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
  };
};

/**
 * Maps `agy acp` session updates (the standard ACP vocabulary) into the shared
 * event contract, plus the steer delivery the session reports as
 * `antigravity_user_message` once agy took a message into the running turn.
 */
export class AntigravityAcpAdapter extends TraeAcpAdapter {
  constructor() {
    super({ eventPrefix: IDENTIFIER, provider: IDENTIFIER });
  }

  override adapt(value: unknown): HeterogeneousAgentEvent[] {
    if (!isRecord(value)) return [];
    if (value.type === `${IDENTIFIER}_user_message`) {
      if (typeof value.uuid !== 'string' || !value.uuid) return [];
      // What the model does next answers the message, in a step of its own.
      this.stream.pendingStepBoundary = true;
      return [this.stream.event('step_complete', { phase: 'user_message', uuid: value.uuid })];
    }
    const events = super.adapt(value);
    if (value.type !== `${IDENTIFIER}_error`) return events;
    // Sign-in and quota failures carry the status guide the UI renders for them.
    const classified = classifyCliMessageError({
      agentType: IDENTIFIER,
      detail: typeof value.message === 'string' ? value.message : undefined,
    });
    return classified
      ? events.map((event) => (event.type === 'error' ? { ...event, data: classified } : event))
      : events;
  }

  protected override toUsageData(usage: unknown): UsageData | undefined {
    return toAntigravityUsage(usage);
  }
}
