import { describe, expect, it } from 'vitest';

import type { PipelineContext } from '../../types';
import { HistorySummaryProvider } from '../HistorySummary';

const createContext = (messages: any[]): PipelineContext => ({
  initialState: { messages: [] } as any,
  messages,
  metadata: { model: 'gpt-4', maxTokens: 4096 },
  isAborted: false,
});

describe('HistorySummaryProvider', () => {
  const mockHistorySummary = 'User discussed AI topics previously';

  it('should inject history summary with default formatting', async () => {
    const provider = new HistorySummaryProvider({
      historySummary: mockHistorySummary,
    });

    const messages = [{ id: 'u1', role: 'user', content: 'Continue our discussion' }];

    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    // Should have system message with formatted history summary
    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage!.content).toContain('<chat_history_summary>');
    expect(systemMessage!.content).toContain(
      '<docstring>Users may have lots of chat messages, here is the summary of the history:</docstring>',
    );
    expect(systemMessage!.content).toContain(`<summary>${mockHistorySummary}</summary>`);
    expect(systemMessage!.content).toContain('</chat_history_summary>');

    // Should update metadata
    expect(result.metadata.historySummary).toEqual({
      injected: true,
      originalLength: mockHistorySummary.length,
      formattedLength: systemMessage!.content.length,
    });
  });

  it('should inject history summary with custom formatting', async () => {
    const customFormatter = (summary: string) => `## History\n${summary}`;
    const provider = new HistorySummaryProvider({
      historySummary: mockHistorySummary,
      formatHistorySummary: customFormatter,
    });

    const messages = [{ id: 'u1', role: 'user', content: 'Continue our discussion' }];

    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    // Should have system message with custom formatted history summary
    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeDefined();
    expect(systemMessage!.content).toBe(`## History\n${mockHistorySummary}`);
  });

  it('should merge history summary with existing system message', async () => {
    const provider = new HistorySummaryProvider({
      historySummary: mockHistorySummary,
    });

    const existingSystemContent = 'You are a helpful assistant.';
    const messages = [
      { id: 's1', role: 'system', content: existingSystemContent },
      { id: 'u1', role: 'user', content: 'Continue our discussion' },
    ];

    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage!.content).toContain(existingSystemContent);
    expect(systemMessage!.content).toContain('<chat_history_summary>');
    expect(systemMessage!.content).toContain(mockHistorySummary);
  });

  it('should skip injection when no history summary is provided', async () => {
    const provider = new HistorySummaryProvider({});

    const messages = [{ id: 'u1', role: 'user', content: 'Hello' }];

    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    // Should not have system message
    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeUndefined();

    // Should not have metadata
    expect(result.metadata.historySummary).toBeUndefined();
  });

  it('should skip injection when history summary is empty', async () => {
    const provider = new HistorySummaryProvider({
      historySummary: '',
    });

    const messages = [{ id: 'u1', role: 'user', content: 'Hello' }];

    const ctx = createContext(messages);
    const result = await provider.process(ctx);

    // Should not have system message
    const systemMessage = result.messages.find((msg) => msg.role === 'system');
    expect(systemMessage).toBeUndefined();
  });
});
