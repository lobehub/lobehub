import { describe, expect, it } from 'vitest';

import {
  chainInputCompletion,
  INPUT_COMPLETION_PROMPT_VERSION,
  INPUT_COMPLETION_SCHEMA_NAME,
} from './inputCompletion';

describe('chainInputCompletion', () => {
  it('returns a system + user message pair', () => {
    const { messages } = chainInputCompletion('How can I ', '');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('Before cursor: "How can I "');
    expect(messages[1].content).toContain('After cursor: ""');
  });

  it('attaches a minimal `{ completion: string }` schema for generateObject', () => {
    const { schema } = chainInputCompletion('hi', '');
    expect(schema.name).toBe(INPUT_COMPLETION_SCHEMA_NAME);
    expect(schema.strict).toBe(true);
    expect(schema.schema.required).toEqual(['completion']);
    expect(schema.schema.additionalProperties).toBe(false);
    expect(schema.schema.properties.completion.type).toBe('string');
  });

  it('adds a separate user message for conversation context when provided', () => {
    const { messages } = chainInputCompletion('write ', '', [
      { content: 'previous response', role: 'assistant' },
      { content: 'previous question', role: 'user' },
    ]);
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[2].role).toBe('user');

    const contextMsg = messages[1].content as string;
    expect(contextMsg).toContain('Current conversation context');
    expect(contextMsg).toContain('assistant: previous response');
    expect(contextMsg).toContain('user: previous question');
    expect(contextMsg).not.toContain('Before cursor');

    const cursorMsg = messages[2].content as string;
    expect(cursorMsg).toContain('Before cursor: "write "');
  });

  it('keeps the system prompt stable regardless of conversation context', () => {
    const a = chainInputCompletion('hi', '');
    const b = chainInputCompletion('hi', '', [
      { content: 'previous response', role: 'assistant' },
      { content: 'previous question', role: 'user' },
    ]);
    expect(a.messages[0].content).toBe(b.messages[0].content);
  });

  it('exports a version constant the call site can pin to metadata', () => {
    expect(INPUT_COMPLETION_PROMPT_VERSION).toMatch(/^v\d+\.\d+$/);
  });
});
