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

  it('appends conversation context to the system prompt when provided', () => {
    const { messages } = chainInputCompletion('write ', '', [
      { content: 'previous response', role: 'assistant' },
      { content: 'previous question', role: 'user' },
    ]);
    const sys = messages[0].content as string;
    expect(sys).toContain('Current conversation context');
    expect(sys).toContain('assistant: previous response');
    expect(sys).toContain('user: previous question');
  });

  it('exports a version constant the call site can pin to metadata', () => {
    expect(INPUT_COMPLETION_PROMPT_VERSION).toMatch(/^v\d+\.\d+$/);
  });
});
