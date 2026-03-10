import { describe, expect, it } from 'vitest';

// Mock DEFAULT_REWRITE_QUERY
import { chainRewriteQuery, DEFAULT_REWRITE_QUERY } from '../rewriteQuery';

describe('chainRewriteQuery', () => {
  it('should generate correct chat payload with default instruction', () => {
    const query = 'What about the weather?';
    const context = ['Previous message 1', 'Previous message 2'];

    const result = chainRewriteQuery(query, context);

    expect(result.messages).toHaveLength(2);
    expect(result.messages![0].role).toBe('system');
    expect(result.messages![1].role).toBe('user');
    expect(result.messages![0].content).toContain(DEFAULT_REWRITE_QUERY);
    expect(result.messages![1].content).toContain(query);
  });

  it('should include chat history in system message', () => {
    const query = 'Follow up question';
    const context = ['User: Hello', 'Assistant: Hi there'];

    const result = chainRewriteQuery(query, context);

    expect(result.messages![0].content).toContain('<chatHistory>');
    expect(result.messages![0].content).toContain('User: Hello');
    expect(result.messages![0].content).toContain('Assistant: Hi there');
    expect(result.messages![0].content).toContain('</chatHistory>');
  });

  it('should use custom instruction when provided', () => {
    const query = 'Test query';
    const context = ['Context'];
    const customInstruction = 'Custom rewrite instruction';

    const result = chainRewriteQuery(query, context, customInstruction);

    expect(result.messages![0].content).toContain(customInstruction);
    expect(result.messages![0].content).not.toContain(DEFAULT_REWRITE_QUERY);
  });

  it('should format user message correctly', () => {
    const query = 'What is the status?';
    const context = ['Previous context'];

    const result = chainRewriteQuery(query, context);

    expect(result.messages![1].content).toBe(`Follow Up Input: ${query}, it's standalone query:`);
  });

  it('should handle empty context array', () => {
    const query = 'Empty context query';
    const context: string[] = [];

    const result = chainRewriteQuery(query, context);

    expect(result.messages![0].content).toContain('<chatHistory>\n\n</chatHistory>');
  });

  it('should handle single context item', () => {
    const query = 'Single context query';
    const context = ['Only one message'];

    const result = chainRewriteQuery(query, context);

    expect(result.messages![0].content).toContain('Only one message');
  });

  it('should join multiple context items with newlines', () => {
    const query = 'Multi context query';
    const context = ['Message 1', 'Message 2', 'Message 3'];

    const result = chainRewriteQuery(query, context);

    expect(result.messages![0].content).toContain('Message 1\nMessage 2\nMessage 3');
  });

  it('should handle special characters in query', () => {
    const query = 'Query with special chars: @#$%^&*()';
    const context = ['Context'];

    const result = chainRewriteQuery(query, context);

    expect(result.messages![1].content).toContain(query);
  });
});
