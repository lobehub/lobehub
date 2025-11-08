import { UIChatMessage } from '@lobechat/types';
import { Mock, describe, expect, it, vi } from 'vitest';

import { chainSummaryHistory } from '../summaryHistory';

describe('chainSummaryHistory', () => {
  it('should use the default model if the token count is below the GPT-3.5 limit', async () => {
    // Arrange
    const messages = [
      { content: 'Hello, how can I assist you?', role: 'assistant' },
      { content: 'I need help with my account.', role: 'user' },
    ] as UIChatMessage[];

    // Act
    const result = chainSummaryHistory(messages);

    // Assert
    expect(result).toMatchSnapshot();
  });
});
