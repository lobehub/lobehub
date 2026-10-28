// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { relaxMoonshotGenerateObjectToolChoice } from './index';

// Kimi rejects forced tool choices while thinking is enabled:
// "tool_choice 'required' is incompatible with thinking enabled"
describe('relaxMoonshotGenerateObjectToolChoice', () => {
  const requestPayload = {
    messages: [{ content: 'Get the result', role: 'user' }],
    tool_choice: 'required',
  };

  it('should use auto tool choice with a tool-use instruction while thinking is enabled', () => {
    for (const model of ['kimi-k2.7-code', 'kimi-k2.6']) {
      const result = relaxMoonshotGenerateObjectToolChoice({ messages: [], model }, requestPayload);

      expect(result.tool_choice).toBe('auto');
      expect(result.messages).toEqual([
        {
          content:
            'You must respond by calling one of the provided tools. Do not reply with plain text.',
          role: 'system',
        },
        ...requestPayload.messages,
      ]);
    }
  });

  it('should keep the forced tool choice when thinking is disabled or unsupported', () => {
    const disabled = relaxMoonshotGenerateObjectToolChoice(
      { messages: [], model: 'kimi-k2.6', thinking: { type: 'disabled' } },
      requestPayload,
    );
    const plain = relaxMoonshotGenerateObjectToolChoice(
      { messages: [], model: 'moonshot-v1-8k' },
      requestPayload,
    );

    expect(disabled).toBe(requestPayload);
    expect(plain).toBe(requestPayload);
  });
});
