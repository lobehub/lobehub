import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { PlaceholderMessageFilterProcessor } from '../PlaceholderMessageFilter';

describe('PlaceholderMessageFilterProcessor', () => {
  const createContext = (messages: any[]): PipelineContext => ({
    initialState: {
      messages: [],
      model: 'test-model',
      provider: 'test-provider',
    },
    isAborted: false,
    messages,
    metadata: {},
  });

  const processor = new PlaceholderMessageFilterProcessor();

  it('should remove failed assistant placeholders that carry an error', async () => {
    // Regression: persisted "..." rows from failed generations poisoned the
    // topic — replayed at the payload tail they trigger the Claude 4.6+
    // assistant-prefill 400 on every subsequent send (LOBE-12572).
    const context = createContext([
      { content: 'hi', id: 'u1', role: 'user' },
      { content: '...', error: { type: 'CapabilityNotSupported' }, id: 'a1', role: 'assistant' },
      { content: 'retry', id: 'u2', role: 'user' },
    ]);

    const result = await processor.process(context);

    expect(result.messages.map((m) => m.id)).toEqual(['u1', 'u2']);
    expect(result.metadata.placeholderMessageFilter).toEqual({ removedCount: 1 });
  });

  it('should remove orphaned placeholders that never got an error written', async () => {
    // A crashed/abandoned run leaves the placeholder row with error = null.
    const context = createContext([
      { content: 'hi', id: 'u1', role: 'user' },
      { content: '...', error: null, id: 'a1', role: 'assistant' },
      { content: '', id: 'a2', role: 'assistant' },
      { content: null, id: 'a3', role: 'assistant' },
    ]);

    const result = await processor.process(context);

    expect(result.messages.map((m) => m.id)).toEqual(['u1']);
    expect(result.metadata.placeholderMessageFilter).toEqual({ removedCount: 3 });
  });

  it('should keep assistant messages with real content, even when errored', async () => {
    const context = createContext([
      {
        content: 'partial answer before failing',
        error: { type: 'Timeout' },
        id: 'a1',
        role: 'assistant',
      },
      { content: 'a full answer', id: 'a2', role: 'assistant' },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(2);
    expect(result.metadata.placeholderMessageFilter).toEqual({ removedCount: 0 });
  });

  it('should keep placeholder-content messages that carry tool calls', async () => {
    const context = createContext([
      { content: '...', id: 'a1', role: 'assistant', tools: [{ id: 'tool_1' }] },
      {
        content: '...',
        id: 'a2',
        role: 'assistant',
        tool_calls: [{ id: 'call_1', type: 'function' }],
      },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(2);
  });

  it('should keep placeholder-content messages that carry reasoning text', async () => {
    const context = createContext([
      { content: '...', id: 'a1', reasoning: { content: 'thought hard' }, role: 'assistant' },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(1);
  });

  it('should keep multimodal array content and non-assistant messages untouched', async () => {
    const context = createContext([
      { content: [{ text: 'img', type: 'text' }], id: 'a1', role: 'assistant' },
      { content: '...', id: 'u1', role: 'user' },
      { content: '', id: 't1', role: 'tool', tool_call_id: 'call_1' },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(3);
  });

  it('should keep intentionally added assistant messages (manual prefill)', async () => {
    // The "add an assistant message" input-menu feature persists a plain
    // assistant row with user-typed content and no error — must never filter.
    const context = createContext([
      { content: 'hi', id: 'u1', role: 'user' },
      { content: 'Sure! Here is my draft:', id: 'a1', role: 'assistant' },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(2);
  });
});
