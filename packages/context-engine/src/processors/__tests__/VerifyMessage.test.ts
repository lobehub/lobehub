import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { VerifyMessageProcessor } from '../VerifyMessage';

describe('VerifyMessageProcessor', () => {
  const createContext = (messages: any[]): PipelineContext => ({
    initialState: { messages: [] },
    isAborted: false,
    messages,
    metadata: {},
  });

  it('drops empty UI-only verify cards from the model context', async () => {
    const processor = new VerifyMessageProcessor();
    const context = createContext([
      { content: 'Hello', role: 'user' },
      { content: '', role: 'verify' },
      { content: 'Hi there', role: 'assistant' },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(2);
    expect(result.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(result.metadata.verifyMessagesRemoved).toBe(1);
    expect(result.metadata.verifyFeedbackSurfaced).toBe(0);
  });

  it('surfaces repair feedback as a tagged user turn', async () => {
    const processor = new VerifyMessageProcessor();
    const context = createContext([
      { content: 'Write a paragraph', role: 'user' },
      { content: 'Done', role: 'assistant' },
      { content: '1. No letter e — the body still contains "e"', role: 'verify' },
    ]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(3);
    const last = result.messages[2];
    expect(last.role).toBe('user');
    expect(last.content).toContain('<delivery_check_feedback>');
    expect(last.content).toContain('No letter e');
    expect(result.metadata.verifyFeedbackSurfaced).toBe(1);
    expect(result.metadata.verifyMessagesRemoved).toBe(0);
  });

  it('treats whitespace-only content as an empty card', async () => {
    const processor = new VerifyMessageProcessor();
    const context = createContext([{ content: '   \n  ', role: 'verify' }]);

    const result = await processor.process(context);

    expect(result.messages).toHaveLength(0);
    expect(result.metadata.verifyMessagesRemoved).toBe(1);
  });
});
