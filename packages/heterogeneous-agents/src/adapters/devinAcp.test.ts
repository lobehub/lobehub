import { describe, expect, it } from 'vitest';

import type { HeterogeneousAgentEvent } from '../types';
import { DevinAcpAdapter } from './devinAcp';

const dataFor = (events: HeterogeneousAgentEvent[], type: HeterogeneousAgentEvent['type']) =>
  events.filter((event) => event.type === type).map((event) => event.data);

describe('DevinAcpAdapter', () => {
  it('emits step_complete with turn_metadata from session/prompt result usage', () => {
    const adapter = new DevinAcpAdapter();

    const events = [
      ...adapter.adapt({ model: 'glm-5-2', sessionId: 'humane-truck', type: 'devin_session' }),
      ...adapter.adapt({
        content: { text: 'done', type: 'text' },
        sessionUpdate: 'agent_message_chunk',
      }),
      ...adapter.adapt({
        stopReason: 'end_turn',
        type: 'devin_prompt_completed',
        usage: {
          cachedReadTokens: 12466,
          inputTokens: 12897,
          outputTokens: 630,
          totalTokens: 13527,
        },
      }),
    ];

    expect(dataFor(events, 'step_complete')).toEqual([
      {
        model: 'glm-5-2',
        phase: 'turn_metadata',
        provider: 'devin',
        usage: {
          inputCachedTokens: 12466,
          inputCacheMissTokens: 431,
          inputWriteCacheTokens: undefined,
          outputReasoningTokens: undefined,
          outputTextTokens: 630,
          totalInputTokens: 12897,
          totalOutputTokens: 630,
          totalTokens: 13527,
        },
      },
    ]);
  });

  it('extracts token usage from usage_update _meta cognition.ai fields', () => {
    const adapter = new DevinAcpAdapter();
    adapter.adapt({ model: 'glm-5-2', sessionId: 'humane-truck', type: 'devin_session' });
    adapter.adapt({
      sessionUpdate: 'usage_update',
      size: 200000,
      used: 12368,
      _meta: {
        'cognition.ai/cachedReadTokens': 50,
        'cognition.ai/inputTokens': 12292,
        'cognition.ai/outputTokens': 76,
      },
    });

    const events = [
      ...adapter.adapt({
        content: { text: 'ok', type: 'text' },
        sessionUpdate: 'agent_message_chunk',
      }),
      ...adapter.adapt({ stopReason: 'end_turn', type: 'devin_prompt_completed' }),
    ];

    expect(dataFor(events, 'step_complete')).toEqual([
      {
        model: 'glm-5-2',
        phase: 'turn_metadata',
        provider: 'devin',
        usage: {
          inputCachedTokens: 50,
          inputCacheMissTokens: 12242,
          inputWriteCacheTokens: undefined,
          outputReasoningTokens: undefined,
          outputTextTokens: 76,
          totalInputTokens: 12292,
          totalOutputTokens: 76,
          totalTokens: 12368,
        },
      },
    ]);
  });

  it('falls back to ACP prompt result usage when usage_update has no _meta', () => {
    const adapter = new DevinAcpAdapter();
    adapter.adapt({ sessionUpdate: 'usage_update', size: 200000, used: 999 });

    const events = adapter.adapt({
      stopReason: 'end_turn',
      type: 'devin_prompt_completed',
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    });

    expect(dataFor(events, 'step_complete')).toEqual([
      {
        phase: 'turn_metadata',
        provider: 'devin',
        usage: {
          inputCacheMissTokens: 100,
          outputTextTokens: 20,
          totalInputTokens: 100,
          totalOutputTokens: 20,
          totalTokens: 120,
        },
      },
    ]);
  });
});
