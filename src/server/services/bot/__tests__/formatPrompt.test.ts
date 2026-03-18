import { describe, expect, it } from 'vitest';

import { formatPrompt, formatReferencedMessage } from '../formatPrompt';

describe('formatReferencedMessage', () => {
  it('should return undefined when raw is undefined', () => {
    expect(formatReferencedMessage(undefined)).toBeUndefined();
  });

  it('should return undefined when referenced_message is missing', () => {
    expect(formatReferencedMessage({})).toBeUndefined();
  });

  it('should return undefined when referenced_message has empty content', () => {
    expect(
      formatReferencedMessage({
        referenced_message: { author: { username: 'someone' }, content: '' },
      }),
    ).toBeUndefined();
  });

  it('should return undefined when referenced_message content is undefined', () => {
    expect(
      formatReferencedMessage({
        referenced_message: { author: { username: 'someone' } },
      }),
    ).toBeUndefined();
  });

  it('should format with global_name as sender', () => {
    expect(
      formatReferencedMessage({
        referenced_message: {
          author: { global_name: 'Alice', username: 'alice123' },
          content: 'original message',
        },
      }),
    ).toBe('<referenced_message sender="Alice">original message</referenced_message>');
  });

  it('should fall back to username when global_name is missing', () => {
    expect(
      formatReferencedMessage({
        referenced_message: {
          author: { username: 'bob456' },
          content: 'some content',
        },
      }),
    ).toBe('<referenced_message sender="bob456">some content</referenced_message>');
  });

  it('should use "unknown" when author is missing', () => {
    expect(
      formatReferencedMessage({
        referenced_message: { content: 'orphan message' },
      }),
    ).toBe('<referenced_message sender="unknown">orphan message</referenced_message>');
  });

  it('should preserve multi-line content', () => {
    expect(
      formatReferencedMessage({
        referenced_message: {
          author: { global_name: 'Charlie' },
          content: 'line one\nline two\nline three',
        },
      }),
    ).toBe(
      '<referenced_message sender="Charlie">line one\nline two\nline three</referenced_message>',
    );
  });
});

describe('formatPrompt', () => {
  const baseMessage = {
    author: { fullName: 'Test User', userId: '111', userName: 'testuser' },
    text: 'hello world',
  };

  const discordSanitize = (text: string) => text.replaceAll(/<@!?bot123>\s*/g, '').trim();

  it('should format basic message with speaker tag', () => {
    const result = formatPrompt(baseMessage);

    expect(result).toContain('hello world');
    expect(result).toContain('<speaker');
    expect(result).toContain('id="111"');
    expect(result).toContain('username="testuser"');
  });

  it('should strip bot @mention from text', () => {
    const msg = { ...baseMessage, text: '<@bot123> hello world' };
    const result = formatPrompt(msg, { sanitizeUserInput: discordSanitize });

    expect(result).toContain('hello world');
    expect(result).not.toContain('<@bot123>');
  });

  it('should strip bot @mention with ! format', () => {
    const msg = { ...baseMessage, text: '<@!bot123> hello world' };
    const result = formatPrompt(msg, { sanitizeUserInput: discordSanitize });

    expect(result).toContain('hello world');
    expect(result).not.toContain('<@!bot123>');
  });

  it('should not strip mentions when no sanitizeUserInput provided', () => {
    const msg = { ...baseMessage, text: '<@bot123> hello world' };
    const result = formatPrompt(msg);

    expect(result).toContain('<@bot123>');
  });

  it('should prepend referenced message before user text', () => {
    const msg = {
      ...baseMessage,
      raw: {
        referenced_message: {
          author: { global_name: 'Alice', username: 'alice' },
          content: 'what about this feature?',
        },
      },
      text: 'I agree with this',
    };
    const result = formatPrompt(msg);

    expect(result).toContain(
      '<referenced_message sender="Alice">what about this feature?</referenced_message>',
    );
    expect(result).toContain('I agree with this');

    // Referenced message should appear before the user's text
    const refIndex = result.indexOf('<referenced_message');
    const textIndex = result.indexOf('I agree with this');
    expect(refIndex).toBeLessThan(textIndex);
  });

  it('should not include referenced_message tag when no reference exists', () => {
    const msg = { ...baseMessage, raw: {} };
    const result = formatPrompt(msg);

    expect(result).not.toContain('<referenced_message');
    expect(result).toContain('hello world');
  });

  it('should use global_name for speaker nickname from raw author', () => {
    const msg = {
      author: { fullName: 'Fallback Name', userId: '222', userName: 'user2' },
      raw: { author: { avatar: 'abc', global_name: 'Display Name' } },
      text: 'test',
    };
    const result = formatPrompt(msg);

    expect(result).toContain('nickname="Display Name"');
  });

  it('should handle both @mention stripping and referenced message together', () => {
    const sanitize = (text: string) => text.replaceAll(/<@!?bot999>\s*/g, '').trim();

    const msg = {
      ...baseMessage,
      raw: {
        referenced_message: {
          author: { global_name: 'Bob', username: 'bob' },
          content: 'can we do this?',
        },
      },
      text: '<@bot999> yes we can',
    };
    const result = formatPrompt(msg, { sanitizeUserInput: sanitize });

    expect(result).not.toContain('<@bot999>');
    expect(result).toContain('yes we can');
    expect(result).toContain(
      '<referenced_message sender="Bob">can we do this?</referenced_message>',
    );
  });

  it('should fall back fullName as nickname when raw author is absent', () => {
    const result = formatPrompt(baseMessage);

    expect(result).toContain('nickname="Test User"');
  });
});
