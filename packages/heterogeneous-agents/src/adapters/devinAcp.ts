import { isRecord } from '@lobechat/utils/object';

import type { UsageData } from '../types';
import { TraeAcpAdapter, type TraeAcpPayload } from './traeAcp';

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
};

/** Maps Devin's ACP `session/update` and `session/prompt` usage into the shared event contract. */
export class DevinAcpAdapter extends TraeAcpAdapter {
  constructor() {
    super({ eventPrefix: 'devin', provider: 'devin' });
  }

  protected override extractUsageFromUsageUpdate(raw: TraeAcpPayload): UsageData | undefined {
    const meta = isRecord(raw._meta) ? raw._meta : undefined;
    if (!meta) return;

    const input = toFiniteNumber(meta['cognition.ai/inputTokens']);
    const output = toFiniteNumber(meta['cognition.ai/outputTokens']);
    if (input === undefined || output === undefined) return;

    const cachedRead = toFiniteNumber(meta['cognition.ai/cachedReadTokens']) ?? 0;
    const cachedWrite = toFiniteNumber(meta['cognition.ai/cachedWriteTokens']) ?? 0;
    const thought =
      toFiniteNumber(meta['cognition.ai/thoughtTokens']) ??
      toFiniteNumber(meta['cognition.ai/reasoningTokens']) ??
      0;

    const inputCacheMiss = Math.max(0, input - cachedRead);
    const outputText = Math.max(0, output - thought);

    return {
      inputCachedTokens: cachedRead || undefined,
      inputCacheMissTokens: inputCacheMiss,
      inputWriteCacheTokens: cachedWrite || undefined,
      outputReasoningTokens: thought || undefined,
      outputTextTokens: outputText,
      totalInputTokens: input + cachedWrite,
      totalOutputTokens: output,
      totalTokens: input + output + cachedWrite,
    };
  }
}
