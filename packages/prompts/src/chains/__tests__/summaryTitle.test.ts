import type { OpenAIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  chainSummaryTitle,
  TOPIC_TITLE_JSON_SCHEMA,
  TOPIC_TITLE_PROMPT_VERSION,
} from '../summaryTitle';

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
    expect(TOPIC_TITLE_PROMPT_VERSION).toBe('v1');
    expect(TOPIC_TITLE_JSON_SCHEMA.name).toBe('topic_title');
  });
});
