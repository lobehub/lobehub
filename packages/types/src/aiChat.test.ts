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

  describe('client-minted ids', () => {
    const parse = (overrides: Record<string, unknown>) =>
      AiSendMessageServerSchema.safeParse({
        newAssistantMessage: { model: 'gpt-4o', provider: 'openai' },
        newUserMessage: { content: 'hello' },
        ...overrides,
      });

    it('should accept well-formed ids', () => {
      expect(
        parse({
          newAssistantMessage: { id: 'msg_aBc123XyZ890', provider: 'openai' },
          newTopic: { id: 'tpc_aBc123XyZ890' },
          newUserMessage: { content: 'hello', id: 'msg_0123456789ab' },
        }).success,
      ).toBe(true);
    });

    it('should stay optional so a client that mints nothing still validates', () => {
      expect(parse({}).success).toBe(true);
    });

    it('should reject ids that are not well-formed', () => {
      // An unvalidated client primary key would let a caller submit look-alike
      // ids, wrong namespaces, or free-form strings that reach the database and
      // leak into logs and URLs.
      const badMessageIds = [
        'msg_admin', // too short to be a real hash
        'tpc_aBc123XyZ890', // right shape, wrong namespace
        'msg_with-dash01', // outside the nanoid alphabet
        'msg_' + 'a'.repeat(33), // oversized
        'not-an-id',
        '',
      ];

      for (const id of badMessageIds) {
        expect(parse({ newUserMessage: { content: 'hello', id } }).success).toBe(false);
      }

      expect(parse({ newTopic: { id: 'msg_aBc123XyZ890' } }).success).toBe(false);
    });
  });
});
