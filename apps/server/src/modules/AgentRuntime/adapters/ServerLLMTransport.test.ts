import { describe, expect, it } from 'vitest';

import { ServerLLMTransport } from './ServerLLMTransport';

describe('ServerLLMTransport retry budget', () => {
  it('keeps background agent failures bounded to one retry', () => {
    const transport = new ServerLLMTransport({} as any);

    expect(transport.retryPolicy.maxAttempts('qwen')).toBe(2);
    expect(transport.retryPolicy.maxAttempts('chatgpt')).toBe(2);
    expect(transport.retryPolicy.maxAttempts('lobehub')).toBe(1);
  });
});
