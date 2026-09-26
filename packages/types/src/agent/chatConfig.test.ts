import { describe, expect, it } from 'vitest';

import { AgentChatConfigSchema } from './chatConfig';

describe('AgentChatConfigSchema', () => {
  describe('contextCachingTTL', () => {
    it('round-trips a valid ttl', () => {
      expect(AgentChatConfigSchema.parse({ contextCachingTTL: '1h' }).contextCachingTTL).toBe('1h');
      expect(AgentChatConfigSchema.parse({ contextCachingTTL: '5m' }).contextCachingTTL).toBe('5m');
    });

    it('rejects an unknown ttl', () => {
      expect(() => AgentChatConfigSchema.parse({ contextCachingTTL: '2h' })).toThrow();
    });
  });
});
