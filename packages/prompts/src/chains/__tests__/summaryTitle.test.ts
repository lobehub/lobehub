import type { OpenAIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { chainSummaryTitle } from '../summaryTitle';

describe('chainSummaryTitle', () => {
  it('should use the default model if the token count is below the GPT-3.5 limit', async () => {
    // Arrange
    const messages: OpenAIChatMessage[] = [
      { content: 'Hello, how can I assist you?', role: 'assistant' },
      { content: 'I need help with my account.', role: 'user' },
    ];
    const currentLanguage = 'en-US';

    // Act
    const result = chainSummaryTitle(messages, currentLanguage);

    // Assert
    expect(result).toMatchSnapshot();
  });
});
