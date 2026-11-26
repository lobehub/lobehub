// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LobeOpenAICompatibleRuntime } from '../../core/BaseAI';
import { LobeOpenRouterAI } from './index';

const loadModelsMock = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

describe('LobeOpenRouterAI - Claude 4.6+/5 assistant prefill guard', () => {
  let instance: LobeOpenAICompatibleRuntime;

  beforeEach(() => {
    instance = new LobeOpenRouterAI({ apiKey: 'test' });
    vi.spyOn(instance['client'].chat.completions, 'create').mockImplementation(
      async () => new ReadableStream() as any,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('strips trailing assistant messages for OpenRouter Claude 4.6+ models without mutating input', async () => {
    const originalMessages = [
      { content: 'You are helpful.', role: 'system' as const },
      { content: 'Explain prefill.', role: 'user' as const },
      { content: 'Earlier draft', role: 'assistant' as const },
      { content: 'Stacked placeholder', role: 'assistant' as const },
    ];
    const snapshot = [...originalMessages];

    await instance.chat({
      messages: originalMessages,
      model: 'anthropic/claude-opus-4.6',
    });

    expect(originalMessages).toEqual(snapshot);
    expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { content: 'You are helpful.', role: 'system' },
          { content: 'Explain prefill.', role: 'user' },
        ],
        model: 'anthropic/claude-opus-4.6',
      }),
      expect.anything(),
    );
  });

  it('strips trailing assistant messages when enabledSearch appends :online suffix', async () => {
    await instance.chat({
      enabledSearch: true,
      messages: [
        { content: 'Search latest docs', role: 'user' },
        { content: 'Interrupted answer', role: 'assistant' },
      ],
      model: 'anthropic/claude-sonnet-4.6',
    });

    expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ content: 'Search latest docs', role: 'user' }],
        model: 'anthropic/claude-sonnet-4.6:online',
      }),
      expect.anything(),
    );
  });

  it('keeps mid-conversation assistant messages intact for Claude 4.6+ and Claude 5', async () => {
    const messages = [
      { content: 'First question', role: 'user' as const },
      { content: 'First answer', role: 'assistant' as const },
      { content: 'Follow-up', role: 'user' as const },
    ];

    await instance.chat({
      messages,
      model: 'anthropic/claude-5-mythos',
    });

    expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        messages,
        model: 'anthropic/claude-5-mythos',
      }),
      expect.anything(),
    );
  });

  it('preserves trailing assistant prefill for older Claude (<4.6) and non-Claude models', async () => {
    const messages = [
      { content: 'Complete JSON:', role: 'user' as const },
      { content: '{', role: 'assistant' as const },
    ];

    await instance.chat({
      messages,
      model: 'anthropic/claude-3.7-sonnet',
    });

    expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        messages,
        model: 'anthropic/claude-3.7-sonnet',
      }),
      expect.anything(),
    );

    await instance.chat({
      messages,
      model: 'openai/gpt-4o',
    });

    expect(instance['client'].chat.completions.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messages,
        model: 'openai/gpt-4o',
      }),
      expect.anything(),
    );
  });

  it('strips trailing assistant messages in generateObject requests for Claude 4.6+', async () => {
    vi.spyOn(instance['client'].chat.completions, 'create').mockResolvedValueOnce({
      choices: [{ message: { content: '{"summary":"ok"}' } }],
    } as any);

    const result = await instance.generateObject!({
      messages: [
        { content: 'Return JSON summary', role: 'user' },
        { content: 'Partial draft', role: 'assistant' },
      ],
      model: 'anthropic/claude-opus-4.6',
      schema: {
        name: 'summary',
        schema: {
          properties: { summary: { type: 'string' } },
          required: ['summary'],
          type: 'object',
        },
      },
    });

    expect(result).toEqual({ summary: 'ok' });
    expect(instance['client'].chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ content: 'Return JSON summary', role: 'user' }],
        model: 'anthropic/claude-opus-4.6',
      }),
      expect.anything(),
    );
  });
});
