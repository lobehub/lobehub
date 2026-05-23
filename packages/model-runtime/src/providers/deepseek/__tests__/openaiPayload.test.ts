// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { openAIParams } from '../index';
import {
  expectNoLoneSurrogateEscapes,
  loneHighSurrogate,
  loneLowSurrogate,
  validEmoji,
} from './testUtils';

describe('DeepSeek OpenAI-compatible chatCompletion.handlePayload', () => {
  it('should transform reasoning object to reasoning_content string', () => {
    const payload = {
      messages: [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: 'Hi there',
          reasoning: { content: 'Let me think...', duration: 1000 },
        },
        { role: 'user', content: 'How are you?' },
      ],
      model: 'deepseek-r1',
    };

    const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

    expect(result.messages).toEqual([
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: 'Hi there',
        reasoning_content: 'Let me think...',
      },
      { role: 'user', content: 'How are you?' },
    ]);
  });

  it('should not modify messages without reasoning field', () => {
    const payload = {
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
      model: 'deepseek-chat',
    };

    const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

    expect(result.messages).toEqual(payload.messages);
  });

  it('should handle empty reasoning content', () => {
    const payload = {
      messages: [
        {
          role: 'assistant',
          content: 'Response',
          reasoning: { duration: 1000 },
        },
      ],
      model: 'deepseek-r1',
    };

    const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

    expect(result.messages[0]).toEqual({
      role: 'assistant',
      content: 'Response',
    });
  });

  it('should set stream to true by default', () => {
    const payload = {
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'deepseek-chat',
    };

    const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

    expect(result.stream).toBe(true);
  });

  it('should remove lone surrogates from OpenAI-compatible chat payload strings', () => {
    const payload = {
      messages: [
        { role: 'user', content: `Hello ${loneHighSurrogate} ${validEmoji}` },
        {
          role: 'assistant',
          content: 'Response',
          reasoning: { content: `Reasoning ${loneLowSurrogate} value` },
        },
      ],
      model: 'deepseek-v4-flash',
    };

    const result = openAIParams.chatCompletion!.handlePayload!(payload as any);
    const serialized = expectNoLoneSurrogateEscapes(result);

    expect(serialized).toContain(validEmoji);
  });

  it('should preserve existing stream value', () => {
    const payload = {
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'deepseek-chat',
      stream: false,
    };

    const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

    expect(result.stream).toBe(false);
  });

  it('should add empty reasoning_content for assistant messages in deepseek-reasoner', () => {
    const payload = {
      messages: [
        { role: 'user', content: 'Search weather' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'search',
                arguments: '{"q":"weather"}',
              },
            },
          ],
        },
        { role: 'tool', content: '{"result":"sunny"}', tool_call_id: 'call_1' },
      ],
      model: 'deepseek-reasoner',
    };

    const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

    expect(result.messages).toEqual([
      { role: 'user', content: 'Search weather' },
      {
        role: 'assistant',
        content: '',
        reasoning_content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'search',
              arguments: '{"q":"weather"}',
            },
          },
        ],
      },
      { role: 'tool', content: '{"result":"sunny"}', tool_call_id: 'call_1' },
    ]);
  });

  it('should preserve existing reasoning_content for deepseek-reasoner assistant messages', () => {
    const payload = {
      messages: [
        {
          role: 'assistant',
          content: 'Previous answer',
          reasoning_content: 'existing reasoning',
        },
      ],
      model: 'deepseek-reasoner',
    };

    const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

    expect(result.messages).toEqual([
      {
        role: 'assistant',
        content: 'Previous answer',
        reasoning_content: 'existing reasoning',
      },
    ]);
  });

  // DeepSeek V4 models default to thinking mode unless thinking.type === 'disabled'.
  // In thinking mode the API rejects follow-up turns whose assistant messages omit
  // reasoning_content when tool calls are involved — see chatPayload.ts for details.
  describe('deepseek-v4 thinking mode reasoning_content enforcement', () => {
    it('should force reasoning_content on v4-flash assistant messages by default', () => {
      const payload = {
        messages: [
          { role: 'user', content: 'Search weather' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'search', arguments: '{"q":"weather"}' },
              },
            ],
          },
        ],
        model: 'deepseek-v4-flash',
      };

      const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages[1]).toEqual({
        role: 'assistant',
        content: '',
        reasoning_content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"weather"}' },
          },
        ],
      });
    });

    it('should force reasoning_content on v4-pro assistant messages by default', () => {
      const payload = {
        messages: [{ role: 'assistant', content: 'hi' }],
        model: 'deepseek-v4-pro',
      };

      const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages[0]).toEqual({
        role: 'assistant',
        content: 'hi',
        reasoning_content: '',
      });
    });

    it('should force reasoning_content when thinking.type is explicitly enabled', () => {
      const payload = {
        messages: [{ role: 'assistant', content: 'hi' }],
        model: 'deepseek-v4-flash',
        thinking: { type: 'enabled' },
      };

      const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages[0]).toEqual({
        role: 'assistant',
        content: 'hi',
        reasoning_content: '',
      });
    });

    it('should NOT force reasoning_content when thinking.type is disabled', () => {
      const payload = {
        messages: [{ role: 'assistant', content: 'hi' }],
        model: 'deepseek-v4-flash',
        thinking: { type: 'disabled' },
      };

      const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages[0]).toEqual({
        role: 'assistant',
        content: 'hi',
      });
    });

    it('should remove reasoning_effort when thinking.type is disabled', () => {
      const payload = {
        messages: [{ role: 'user', content: 'hi' }],
        model: 'deepseek-v4-flash',
        reasoning_effort: 'high',
        thinking: { type: 'disabled' },
      };

      const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

      expect(result).toEqual({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'deepseek-v4-flash',
        stream: true,
        thinking: { type: 'disabled' },
      });
    });

    it('should preserve reasoning_effort when thinking is enabled', () => {
      const payload = {
        messages: [{ role: 'user', content: 'hi' }],
        model: 'deepseek-v4-flash',
        reasoning_effort: 'high',
        thinking: { type: 'enabled' },
      };

      const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

      expect(result.reasoning_effort).toBe('high');
    });

    it('should preserve existing reasoning_content on v4 assistant messages', () => {
      const payload = {
        messages: [
          {
            role: 'assistant',
            content: 'answer',
            reasoning_content: 'prior reasoning',
          },
        ],
        model: 'deepseek-v4-flash',
      };

      const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages[0]).toEqual({
        role: 'assistant',
        content: 'answer',
        reasoning_content: 'prior reasoning',
      });
    });

    it('should NOT force reasoning_content on non-v4 / non-reasoner models', () => {
      const payload = {
        messages: [{ role: 'assistant', content: 'hi' }],
        model: 'deepseek-chat',
      };

      const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

      expect(result.messages[0]).toEqual({
        role: 'assistant',
        content: 'hi',
      });
    });
  });

  it('should add empty reasoning_content for assistant messages in deepseek-v4-pro thinking mode', () => {
    const payload = {
      messages: [
        { role: 'user', content: 'Call a tool' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'lookup',
                arguments: '{"q":"docs"}',
              },
            },
          ],
        },
      ],
      model: 'deepseek-v4-pro',
    };

    const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

    expect(result.messages).toEqual([
      { role: 'user', content: 'Call a tool' },
      {
        role: 'assistant',
        content: '',
        reasoning_content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'lookup',
              arguments: '{"q":"docs"}',
            },
          },
        ],
      },
    ]);
  });

  it('should preserve only supported DeepSeek thinking config fields', () => {
    const payload = {
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'deepseek-v4-flash',
      reasoning_effort: 'high' as const,
      thinking: {
        budget_tokens: 4096,
        type: 'enabled' as const,
      },
    };

    const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

    expect(result.reasoning_effort).toBe('high');
    expect(result).toEqual(expect.objectContaining({ thinking: { type: 'enabled' } }));
    expect(result).not.toEqual(
      expect.objectContaining({ thinking: expect.objectContaining({ budget_tokens: 4096 }) }),
    );
  });

  it('should forward disabled thinking mode for deepseek-v4-pro', () => {
    const payload = {
      messages: [{ role: 'user', content: 'Hello' }],
      model: 'deepseek-v4-pro',
      thinking: { type: 'disabled' as const },
    };

    const result = openAIParams.chatCompletion!.handlePayload!(payload as any);

    expect(result).toEqual(expect.objectContaining({ thinking: { type: 'disabled' } }));
  });
});
