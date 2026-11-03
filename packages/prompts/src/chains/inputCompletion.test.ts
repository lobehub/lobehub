import { describe, expect, it } from 'vitest';

import {
  chainInputCompletion,
  INPUT_COMPLETION_PROMPT_VERSION,
  INPUT_COMPLETION_SCHEMA_NAME,
} from './inputCompletion';

describe('chainInputCompletion', () => {
  it('returns a system + user message pair with the draft and cursor marker', () => {
    const { messages } = chainInputCompletion('How can I ', '');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');

    const draft = messages[1].content as string;
    expect(draft).toContain('<draft>');
    expect(draft).toContain('How can I ');
    // beforeCursor is immediately followed by the cursor marker
    expect(draft).toContain('How can I <|cursor|>');
  });

  it('places afterCursor text on the far side of the cursor marker', () => {
    const { messages } = chainInputCompletion('fix the ', ' bug');
    expect(messages[1].content as string).toContain('fix the <|cursor|> bug');
  });

  it('attaches a minimal `{ completion: string }` schema for generateObject', () => {
    const { schema } = chainInputCompletion('hi', '');
    expect(schema.name).toBe(INPUT_COMPLETION_SCHEMA_NAME);
    expect(schema.strict).toBe(true);
    expect(schema.schema.required).toEqual(['completion']);
    expect(schema.schema.additionalProperties).toBe(false);
    expect(schema.schema.properties.completion.type).toBe('string');
  });

  it('folds conversation context into the single user message as a labelled block', () => {
    const { messages } = chainInputCompletion('write ', '', [
      { content: 'previous response', role: 'assistant' },
      { content: 'previous question', role: 'user' },
    ]);
    // Context is NOT replayed as real role turns — still just system + user.
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');

    const content = messages[1].content as string;
    expect(content).toContain('<conversation>');
    expect(content).toContain('Assistant: previous response');
    expect(content).toContain('User: previous question');
    // The draft still appears, after the context block.
    expect(content.indexOf('<conversation>')).toBeLessThan(content.indexOf('<draft>'));
    expect(content).toContain('write <|cursor|>');
  });

  it('omits the conversation block when there is no context', () => {
    const { messages } = chainInputCompletion('hi', '');
    expect(messages[1].content as string).not.toContain('<conversation>');
  });

  it('keeps only the most recent turns and drops non user/assistant + empty messages', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      content: `msg ${i}`,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'assistant' | 'user',
    }));
    const { messages } = chainInputCompletion('next ', '', [
      { content: 'system noise', role: 'system' },
      { content: '   ', role: 'user' },
      ...many,
    ]);
    const content = messages[1].content as string;
    // Last 8 of the 12 valid turns survive; the earliest do not.
    expect(content).toContain('msg 11');
    expect(content).toContain('msg 4');
    expect(content).not.toContain('msg 3');
    expect(content).not.toContain('system noise');
  });

  it('clips an over-long message so it cannot crowd out the draft', () => {
    const huge = 'x'.repeat(5000);
    const { messages } = chainInputCompletion('go ', '', [{ content: huge, role: 'user' }]);
    const content = messages[1].content as string;
    expect(content).toContain('…');
    expect(content).not.toContain('x'.repeat(1100));
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
