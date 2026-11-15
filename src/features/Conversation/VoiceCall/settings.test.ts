import {
  conversationConfigSchema,
  voiceResultSchema,
  voiceTurnSchema,
} from '@lobechat/livekit-bridge';
import { describe, expect, it } from 'vitest';

describe('Conversation configuration', () => {
  it('defaults to disabled personal configuration', () => {
    expect(conversationConfigSchema.parse({}).enabled).toBe(false);
  });
  it('does not add or override the reasoning model or harness', () => {
    expect(
      conversationConfigSchema.parse({ model: 'replace-agent', provider: 'other' }),
    ).not.toHaveProperty('model');
    expect(conversationConfigSchema.parse({})).not.toHaveProperty('provider');
  });
  it('rejects invalid speech settings and oversized remote turn payloads', () => {
    expect(() => conversationConfigSchema.parse({ silenceMs: -1 })).toThrow();
    expect(() => conversationConfigSchema.parse({ voice: 'x'.repeat(257) })).toThrow();
    expect(() =>
      voiceTurnSchema.parse({ requestId: crypto.randomUUID(), text: 'x'.repeat(4001) }),
    ).toThrow();
    expect(() =>
      voiceResultSchema.parse({ ok: true, requestId: crypto.randomUUID(), text: '' }),
    ).toThrow();
  });
});
