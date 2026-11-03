import { describe, expect, it } from 'vitest';

import type { Message } from './index';
import { conversationToText } from './index';

describe('conversationToText', () => {
  it('should format a single message correctly', () => {
    const messages: Message[] = [{ role: 'user', content: 'Hello, how are you?' }];

    const result = conversationToText(messages);

    expect(result).toMatchSnapshot();
  });

  it('should format multiple messages correctly', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello, how are you?' },
      { role: 'assistant', content: 'I am doing well, thank you!' },
      { role: 'user', content: 'What is the weather like?' },
    ];

    const result = conversationToText(messages);

    expect(result).toMatchSnapshot();
  });

  it('should handle empty messages array', () => {
    const messages: Message[] = [];

    const result = conversationToText(messages);

    expect(result).toMatchSnapshot();
  });

  it('should handle messages with different roles', () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Tell me a joke.' },
      { role: 'assistant', content: 'Why did the chicken cross the road?' },
    ];

    const result = conversationToText(messages);

    expect(result).toMatchSnapshot();
  });

  it('should handle messages with special characters', () => {
    const messages: Message[] = [
      { role: 'user', content: 'What is 2 + 2?' },
      { role: 'assistant', content: 'The answer is 4.' },
    ];

    const result = conversationToText(messages);

    expect(result).toMatchSnapshot();
  });

  it('should handle multiline content', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: `This is a multiline message.
It has multiple lines.
Line 3 here.`,
      },
    ];

    const result = conversationToText(messages);

    expect(result).toMatchSnapshot();
  });
});
