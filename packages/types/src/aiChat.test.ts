import { describe, expect, it } from 'vitest';

import { AiSendMessageServerSchema } from './aiChat';

const createInput = (topicPageSize: number) => ({
  newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
  newUserMessage: { content: 'hello' },
  topicPageSize,
});

describe('AiSendMessageServerSchema', () => {
  it('should only accept positive integer topic page sizes up to 100', () => {
    for (const topicPageSize of [1, 20, 100]) {
      expect(AiSendMessageServerSchema.safeParse(createInput(topicPageSize)).success).toBe(true);
    }

    for (const topicPageSize of [-1, 0, 1.5, 101]) {
      expect(AiSendMessageServerSchema.safeParse(createInput(topicPageSize)).success).toBe(false);
    }
  });
});
