import type { UIChatMessage } from '@lobechat/types';
import type { Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import {
  collectDisplayedMessageIds,
  estimateNextReplyCost,
  getPromptCacheSnapshot,
  isIdleCacheNoticeworthy,
} from './promptCacheState';

const sonnetPricing: Pricing = {
  units: [
    { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
    { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
    {
      lookup: { prices: { '1h': 6, '5m': 3.75 }, pricingParams: ['ttl'] },
      name: 'textInput_cacheWrite',
      strategy: 'lookup',
      unit: 'millionTokens',
    },
  ],
};

const message = (overrides: Partial<UIChatMessage>): UIChatMessage =>
  ({
    content: '',
    createdAt: 0,
    id: 'msg',
    role: 'user',
    updatedAt: 0,
    ...overrides,
  }) as UIChatMessage;

const cachedReply = (overrides: Partial<UIChatMessage> = {}) =>
  message({
    id: 'reply',
    metadata: { promptCache: { requestStartedAt: 1_000, ttlSeconds: 300 } },
    model: 'claude-sonnet',
    provider: 'anthropic',
    role: 'assistant',
    usage: { totalInputTokens: 180_000, totalOutputTokens: 2_000 },
    ...overrides,
  });

/** Every message is on the shown branch. */
const allIds = (messages: UIChatMessage[]) => new Set(messages.map((m) => m.id));

describe('getPromptCacheSnapshot', () => {
  it('reads the cache lifetime of the latest reply', () => {
    const messages = [message({ id: 'q' }), cachedReply()];

    expect(getPromptCacheSnapshot(messages, allIds(messages))).toEqual({
      contextTokens: 182_000,
      expiresAt: 301_000,
      inputTokens: 180_000,
      messageId: 'reply',
      model: 'claude-sonnet',
      provider: 'anthropic',
      ttlSeconds: 300,
    });
  });

  it('skips the user and usage-less messages a failed run left after the reply', () => {
    const messages = [
      cachedReply(),
      message({ id: 'retry' }),
      message({ id: 'failed', role: 'assistant' }),
    ];
    const snapshot = getPromptCacheSnapshot(messages, allIds(messages));

    expect(snapshot?.messageId).toBe('reply');
  });

  it('guesses nothing when the latest reply did not ask for caching', () => {
    const older = cachedReply({ id: 'older' });
    const uncached = cachedReply({ id: 'uncached', metadata: {} });

    expect(getPromptCacheSnapshot([older, uncached], allIds([older, uncached]))).toBeUndefined();
  });

  it('reads the branch the user switched to, not a newer reply on a hidden branch', () => {
    // Regenerating left a long reply on another branch; the user switched back to the short one.
    const shown = cachedReply({ id: 'shown', usage: { totalInputTokens: 20_000 } });
    const hidden = cachedReply({
      id: 'hidden',
      model: 'gpt',
      usage: { totalInputTokens: 300_000 },
    });
    const displayed = [message({ id: 'q' }), shown];

    const snapshot = getPromptCacheSnapshot(
      [message({ id: 'q' }), shown, hidden],
      collectDisplayedMessageIds(displayed),
    );

    expect(snapshot).toMatchObject({ inputTokens: 20_000, messageId: 'shown' });
  });

  it('finds a reply folded into an assistant group row', () => {
    const reply = cachedReply({ id: 'block-2' });
    const group = message({
      children: [{ id: 'block-1' }, { id: 'block-2' }] as UIChatMessage['children'],
      id: 'block-1',
      role: 'assistantGroup',
    });

    expect(getPromptCacheSnapshot([reply], collectDisplayedMessageIds([group]))?.messageId).toBe(
      'block-2',
    );
  });
});

describe('estimateNextReplyCost', () => {
  it('prices an expired cache as a full cache write and a warm one as a cache read', () => {
    const snapshot = getPromptCacheSnapshot([cachedReply()], new Set(['reply']))!;
    const cost = estimateNextReplyCost(snapshot, sonnetPricing, 0)!;

    // cold: 182k × $3.75/M; warm: 180k × $0.3/M + 2k × $3.75/M
    expect(cost.coldCost).toBeCloseTo(0.6825, 6);
    expect(cost.warmCost).toBeCloseTo(0.054 + 0.0075, 6);
  });

  it('returns undefined for a model without a price', () => {
    const snapshot = getPromptCacheSnapshot([cachedReply()], new Set(['reply']))!;

    expect(estimateNextReplyCost(snapshot, undefined)).toBeUndefined();
  });
});

describe('isIdleCacheNoticeworthy', () => {
  const snapshot = getPromptCacheSnapshot([cachedReply()], new Set(['reply']))!;

  it('shows once re-reading costs at least $0.25 more and the context fills 20% of the window', () => {
    expect(isIdleCacheNoticeworthy(snapshot, { coldCost: 0.7, warmCost: 0.1 }, 200_000)).toBe(true);
  });

  it('stays quiet when the re-read costs only cents more', () => {
    expect(isIdleCacheNoticeworthy(snapshot, { coldCost: 0.3, warmCost: 0.1 }, 200_000)).toBe(
      false,
    );
  });

  it('stays quiet when the conversation fills a small part of a large window', () => {
    expect(isIdleCacheNoticeworthy(snapshot, { coldCost: 3, warmCost: 0.3 }, 1_000_000)).toBe(
      false,
    );
  });

  it("stays quiet when the model's card states no context window", () => {
    expect(isIdleCacheNoticeworthy(snapshot, { coldCost: 3, warmCost: 0.3 })).toBe(false);
  });
});
