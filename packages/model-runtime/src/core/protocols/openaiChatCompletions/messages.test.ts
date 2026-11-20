import type OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';

import { imageUrlToBase64 } from '../../../utils/imageToBase64';
import { serializeScopedSignature, type SignatureScope } from '../../../utils/signatureScope';
import { parseDataUri } from '../../../utils/uriParser';
import { convertOpenAIMessages } from './messages';

// 模拟依赖
vi.mock('../../../utils/imageToBase64', () => ({
  imageUrlToBase64: vi.fn(),
}));
vi.mock('../../../utils/videoToBase64', () => ({
  videoUrlToBase64: vi.fn(),
}));
vi.mock('../../../utils/uriParser');

describe('convertOpenAIMessages', () => {
  it('should restore thoughtSignature only for the exact scope', async () => {
    const scope: SignatureScope = { fingerprint: 'a'.repeat(32) };
    const foreignScope: SignatureScope = { fingerprint: 'b'.repeat(32) };
    const thoughtSignature = serializeScopedSignature(
      'google-signature',
      scope,
      'thought_signature',
    );
    const messages = [
      {
        content: '',
        role: 'assistant',
        tool_calls: [
          {
            function: { arguments: '{}', name: 'get_weather' },
            id: 'call_1',
            thoughtSignature,
            type: 'function',
          },
        ],
      },
    ] as any;

    const matching = await convertOpenAIMessages(messages, { thoughtSignatureScope: scope });
    const mismatching = await convertOpenAIMessages(messages, {
      thoughtSignatureScope: foreignScope,
    });
    const legacy = await convertOpenAIMessages(
      [
        {
          ...messages[0],
          tool_calls: [{ ...messages[0].tool_calls[0], thoughtSignature: 'legacy-signature' }],
        },
      ],
      { thoughtSignatureScope: scope },
    );

    expect((matching[0] as any).tool_calls[0].thoughtSignature).toBe('google-signature');
    expect((mismatching[0] as any).tool_calls[0].thoughtSignature).toBeUndefined();
    expect((legacy[0] as any).tool_calls[0].thoughtSignature).toBeUndefined();
  });

  it('should convert string content messages', async () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ] as OpenAI.ChatCompletionMessageParam[];

    const result = await convertOpenAIMessages(messages);

    expect(result).toEqual(messages);
  });

  it('should convert array content messages', async () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
        ],
      },
    ] as OpenAI.ChatCompletionMessageParam[];

    vi.spyOn(Promise, 'all');
    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
    vi.mocked(imageUrlToBase64).mockResolvedValue({
      base64: 'base64String',
      mimeType: 'image/jpeg',
    });

    process.env.LLM_VISION_IMAGE_USE_BASE64 = '1';

    const result = await convertOpenAIMessages(messages);

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/jpeg;base64,base64String' },
          },
        ],
      },
    ]);

    expect(Promise.all).toHaveBeenCalledTimes(2); // 一次用于消息数组，一次用于内容数组

    process.env.LLM_VISION_IMAGE_USE_BASE64 = undefined;
  });
  it('should convert array content messages', async () => {
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } },
        ],
      },
    ] as OpenAI.ChatCompletionMessageParam[];

    vi.spyOn(Promise, 'all');
    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
    vi.mocked(imageUrlToBase64).mockResolvedValue({
      base64: 'base64String',
      mimeType: 'image/jpeg',
    });

    const result = await convertOpenAIMessages(messages);

    expect(result).toEqual(messages);

    expect(Promise.all).toHaveBeenCalledTimes(2); // 一次用于消息数组，一次用于内容数组
  });

  it('should filter out reasoning field from messages', async () => {
    const messages = [
      {
        role: 'assistant',
        content: 'Hello',
        reasoning: { content: 'some reasoning', duration: 100 },
      },
      { role: 'user', content: 'Hi' },
    ] as any;

    const result = await convertOpenAIMessages(messages);

    expect(result).toEqual([
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'Hi' },
    ]);
    // Ensure reasoning field is removed
    expect((result[0] as any).reasoning).toBeUndefined();
  });

  describe('reasoning passback for thinking families', () => {
    // Upstream rejects a thinking-mode turn that carries tool_calls without the
    // historical reasoning: "If thinking mode and tool_calls, `reasoning_content`
    // must be passed back to the API."
    const assistantTurn = {
      content: 'Calling a tool',
      reasoning: { content: 'step-by-step thinking' },
      role: 'assistant',
      tool_calls: [
        { function: { arguments: '{}', name: 'search' }, id: 'call-1', type: 'function' },
      ],
    } as any;

    it.each([['deepseek-v4-pro'], ['glm-5.3'], ['kimi-k3']])(
      'echoes structured reasoning back for %s',
      async (model) => {
        const result = await convertOpenAIMessages([assistantTurn], { model });

        expect((result[0] as any).reasoning_content).toBe('step-by-step thinking');
      },
    );

    it('leaves unrelated models untouched', async () => {
      const result = await convertOpenAIMessages([assistantTurn], { model: 'gpt-5.6-sol' });

      expect((result[0] as any).reasoning_content).toBeUndefined();
    });

    it('keeps the empty placeholder scoped to DeepSeek thinking models', async () => {
      const withoutReasoning = { ...assistantTurn, reasoning: undefined };

      const deepseek = await convertOpenAIMessages([withoutReasoning], {
        model: 'deepseek-v4-pro',
      });
      const glm = await convertOpenAIMessages([withoutReasoning], { model: 'glm-5.3' });

      expect((deepseek[0] as any).reasoning_content).toBe('');
      expect((glm[0] as any).reasoning_content).toBeUndefined();
    });
  });

  it('should preserve reasoning_content field from messages (for DeepSeek compatibility)', async () => {
    const messages = [
      {
        role: 'assistant',
        content: 'Hello',
        reasoning_content: 'some reasoning content',
      },
      { role: 'user', content: 'Hi' },
    ] as any;

    const result = await convertOpenAIMessages(messages);

    expect(result).toEqual([
      { role: 'assistant', content: 'Hello', reasoning_content: 'some reasoning content' },
      { role: 'user', content: 'Hi' },
    ]);
    // Ensure reasoning_content field is preserved
    expect((result[0] as any).reasoning_content).toBe('some reasoning content');
  });

  it('should filter internal thinking content parts but preserve reasoning_content', async () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          {
            signature: 'sig_123',
            thinking: 'internal reasoning',
            type: 'thinking',
          },
          {
            text: 'Visible answer',
            type: 'text',
          },
        ],
        reasoning_content: 'internal reasoning',
      },
    ] as any;

    const result = await convertOpenAIMessages(messages);

    expect(result).toEqual([
      {
        role: 'assistant',
        content: [{ text: 'Visible answer', type: 'text' }],
        reasoning_content: 'internal reasoning',
      },
    ]);
  });

  it('should filter out reasoning but preserve reasoning_content field', async () => {
    const messages = [
      {
        role: 'assistant',
        content: 'Hello',
        reasoning: { content: 'some reasoning', duration: 100 },
        reasoning_content: 'some reasoning content',
      },
    ] as any;

    const result = await convertOpenAIMessages(messages);

    expect(result).toEqual([
      { role: 'assistant', content: 'Hello', reasoning_content: 'some reasoning content' },
    ]);
    // Ensure reasoning object is removed but reasoning_content is preserved
    expect((result[0] as any).reasoning).toBeUndefined();
    expect((result[0] as any).reasoning_content).toBe('some reasoning content');
  });

  describe('tool messages with image parts', () => {
    it('should flatten the tool message to text and re-attach images as a user message', async () => {
      vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });

      const messages = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'readFile', arguments: '{}' } },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: [
            { type: 'text', text: '[Image: cat.png]' },
            { type: 'image_url', image_url: { url: 'https://files.example.com/cat.png' } },
          ],
        },
        { role: 'user', content: 'what do you see?' },
      ] as OpenAI.ChatCompletionMessageParam[];

      const result = await convertOpenAIMessages(messages);

      expect(result).toEqual([
        messages[0],
        // Tool message content must be text-only for the OpenAI API.
        { role: 'tool', tool_call_id: 'call_1', content: '[Image: cat.png]' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Image output of tool call call_1:' },
            { type: 'image_url', image_url: { url: 'https://files.example.com/cat.png' } },
          ],
        },
        { role: 'user', content: 'what do you see?' },
      ]);
    });

    it('should keep the tool batch contiguous when multiple tool results carry images', async () => {
      vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });

      const messages = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'readFile', arguments: '{}' } },
            { id: 'call_2', type: 'function', function: { name: 'readFile', arguments: '{}' } },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: [{ type: 'image_url', image_url: { url: 'https://files.example.com/a.png' } }],
        },
        {
          role: 'tool',
          tool_call_id: 'call_2',
          content: 'plain text result',
        },
      ] as OpenAI.ChatCompletionMessageParam[];

      const result = await convertOpenAIMessages(messages);

      // No user message may interleave between the tool results of one batch.
      expect(result.map((m) => m.role)).toEqual(['assistant', 'tool', 'tool', 'user']);
      expect(result[1]).toEqual({
        role: 'tool',
        tool_call_id: 'call_1',
        content: '[Image output attached below]',
      });
      expect(result[2]).toEqual(messages[2]);
      expect(result[3]).toEqual({
        role: 'user',
        content: [
          { type: 'text', text: 'Image output of tool call call_1:' },
          { type: 'image_url', image_url: { url: 'https://files.example.com/a.png' } },
        ],
      });
    });
  });

  describe('DeepSeek reasoning_content compatibility', () => {
    it('should derive reasoning_content from reasoning.content for deepseek models', async () => {
      const messages = [
        {
          role: 'assistant',
          content: 'Answer with tool call',
          reasoning: { content: 'planned tool invocation', duration: 100 },
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'search', arguments: '{}' } },
          ],
        },
      ] as any;

      const result = await convertOpenAIMessages(messages, { model: 'deepseek-v4-flash' });

      expect((result[0] as any).reasoning_content).toBe('planned tool invocation');
      expect((result[0] as any).tool_calls).toHaveLength(1);
      expect((result[0] as any).reasoning).toBeUndefined();
    });

    it('should force empty reasoning_content for deepseek-v4 thinking-mode assistant messages without reasoning', async () => {
      const messages = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'search', arguments: '{}' } },
          ],
        },
      ] as any;

      const result = await convertOpenAIMessages(messages, { model: 'deepseek-v4-pro' });

      expect((result[0] as any).reasoning_content).toBe('');
    });

    it('should force empty reasoning_content for deepseek-reasoner', async () => {
      const messages = [{ role: 'assistant', content: 'Hi' }] as any;

      const result = await convertOpenAIMessages(messages, { model: 'deepseek-reasoner' });

      expect((result[0] as any).reasoning_content).toBe('');
    });

    it('should match provider-prefixed deepseek model ids (e.g. Deepseek/deepseek-v4-pro)', async () => {
      const messages = [{ role: 'assistant', content: 'Hi' }] as any;

      const result = await convertOpenAIMessages(messages, {
        model: 'Deepseek/deepseek-v4-pro',
      });

      expect((result[0] as any).reasoning_content).toBe('');
    });

    it('should not force reasoning_content for non-thinking deepseek models', async () => {
      const messages = [{ role: 'assistant', content: 'Hi' }] as any;

      const result = await convertOpenAIMessages(messages, { model: 'deepseek-chat' });

      expect((result[0] as any).reasoning_content).toBeUndefined();
    });

    it('should leave non-deepseek models untouched', async () => {
      const messages = [
        {
          role: 'assistant',
          content: 'Hi',
          reasoning: { content: 'unrelated', duration: 10 },
        },
      ] as any;

      const result = await convertOpenAIMessages(messages, { model: 'gpt-4o-mini' });

      expect((result[0] as any).reasoning_content).toBeUndefined();
      expect((result[0] as any).reasoning).toBeUndefined();
    });

    it('should not touch non-assistant messages', async () => {
      const messages = [
        { role: 'user', content: 'hello' },
        { role: 'tool', content: '{}', tool_call_id: 'call_1' },
      ] as any;

      const result = await convertOpenAIMessages(messages, { model: 'deepseek-v4-flash' });

      expect((result[0] as any).reasoning_content).toBeUndefined();
      expect((result[1] as any).reasoning_content).toBeUndefined();
    });

    it('should preserve existing reasoning_content over reasoning.content', async () => {
      const messages = [
        {
          role: 'assistant',
          content: 'Hi',
          reasoning: { content: 'should be ignored', duration: 10 },
          reasoning_content: 'kept',
        },
      ] as any;

      const result = await convertOpenAIMessages(messages, { model: 'deepseek-v4-flash' });

      expect((result[0] as any).reasoning_content).toBe('kept');
    });
  });
});
