import { describe, expect, it, vi } from 'vitest';

import type { OpenAIChatMessage } from '../../../types';
import { imageUrlToBase64 } from '../../../utils/imageToBase64';
import { serializeScopedSignature, type SignatureScope } from '../../../utils/signatureScope';
import { parseDataUri } from '../../../utils/uriParser';
import { videoUrlToBase64 } from '../../../utils/videoToBase64';
import { convertOpenAIResponseInputs } from './inputs';

// 模拟依赖
vi.mock('../../../utils/imageToBase64', () => ({
  imageUrlToBase64: vi.fn(),
}));
vi.mock('../../../utils/videoToBase64', () => ({
  videoUrlToBase64: vi.fn(),
}));
vi.mock('../../../utils/uriParser');

describe('convertOpenAIResponseInputs', () => {
  it('should reject raw audio explicitly instead of dropping it from Responses input', async () => {
    const messages: OpenAIChatMessage[] = [
      {
        content: [
          {
            audio_url: { mimeType: 'audio/wav', url: 'https://files.example.com/voice.wav' },
            type: 'audio_url',
          },
        ],
        role: 'user',
      },
    ];

    await expect(convertOpenAIResponseInputs(messages)).rejects.toThrow(
      'OpenAI raw audio input requires the Chat Completions API',
    );
  });

  it('应该正确转换普通文本消息', async () => {
    const messages: OpenAIChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ]);
  });

  it('应该正确转换带有工具调用的消息', async () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'test_function',
              arguments: '{"key": "value"}',
            },
          },
        ],
      },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      {
        arguments: 'test_function',
        call_id: 'call_123',
        name: 'test_function',
        type: 'function_call',
      },
    ]);
  });

  it('应该正确转换工具响应消息', async () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'tool',
        content: 'Function result',
        tool_call_id: 'call_123',
      },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      {
        call_id: 'call_123',
        output: 'Function result',
        type: 'function_call_output',
      },
    ]);
  });

  it('工具响应带图片时应保持 output 纯文本并追加 user 图片消息', async () => {
    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });

    const messages: OpenAIChatMessage[] = [
      {
        content: [
          { text: '[Image: cat.png]', type: 'text' },
          { image_url: { url: 'https://files.example.com/cat.png' }, type: 'image_url' },
        ] as any,
        role: 'tool',
        tool_call_id: 'call_123',
      },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      {
        call_id: 'call_123',
        // function_call_output.output is text-only — images must not land here.
        output: '[Image: cat.png]',
        type: 'function_call_output',
      },
      {
        content: [
          { text: 'Image output of tool call call_123:', type: 'input_text' },
          { image_url: 'https://files.example.com/cat.png', type: 'input_image' },
        ],
        role: 'user',
        type: 'message',
      },
    ]);
  });

  it('应该正确转换包含图片的消息', async () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Here is an image' },
          {
            type: 'image_url',
            image_url: {
              url: 'data:image/jpeg;base64,test123',
            },
          },
        ],
      },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Here is an image' },
          {
            type: 'input_image',
            image_url: 'data:image/jpeg;base64,test123',
          },
        ],
      },
    ]);
  });

  it('should preserve the requested image detail on input_image parts', async () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Inspect the circled area' },
          {
            type: 'image_url',
            image_url: { detail: 'high', url: 'data:image/png;base64,test123' },
          },
        ],
      },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Inspect the circled area' },
          { detail: 'high', image_url: 'data:image/png;base64,test123', type: 'input_image' },
        ],
      },
    ]);
  });

  it('应该正确转换包含视频的消息', async () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Here is a video' },
          {
            type: 'video_url',
            video_url: {
              url: 'data:video/mp4;base64,test123',
            },
          },
        ],
      },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Here is a video' },
          {
            type: 'input_video',
            video_url: 'data:video/mp4;base64,test123',
          },
        ],
      },
    ]);
  });

  it('应该正确转换包含图片和视频的混合消息', async () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Here is an image and a video' },
          {
            type: 'image_url',
            image_url: {
              url: 'data:image/jpeg;base64,test123',
            },
          },
          {
            type: 'video_url',
            video_url: {
              url: 'data:video/mp4;base64,test456',
            },
          },
        ],
      },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Here is an image and a video' },
          {
            type: 'input_image',
            image_url: 'data:image/jpeg;base64,test123',
          },
          {
            type: 'input_video',
            video_url: 'data:video/mp4;base64,test456',
          },
        ],
      },
    ]);
  });

  it('应该正确处理带有无效 video_url 的消息', async () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Here is a video' },
          {
            type: 'video_url',
            video_url: {
              url: '',
            },
          },
        ],
      },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Here is a video' }],
      },
    ]);
  });

  it('应该正确处理混合类型的消息序列', async () => {
    const messages: OpenAIChatMessage[] = [
      { role: 'user', content: 'I need help with a function' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_456',
            type: 'function',
            function: {
              name: 'get_data',
              arguments: '{}',
            },
          },
        ],
      },
      {
        role: 'tool',
        content: '{"result": "success"}',
        tool_call_id: 'call_456',
      },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      { role: 'user', content: 'I need help with a function' },
      {
        arguments: 'get_data',
        call_id: 'call_456',
        name: 'get_data',
        type: 'function_call',
      },
      {
        call_id: 'call_456',
        output: '{"result": "success"}',
        type: 'function_call_output',
      },
    ]);
  });

  it('should filter orphan tool calls when strictToolPairing is enabled', async () => {
    const messages: OpenAIChatMessage[] = [
      { role: 'user', content: 'Use tools carefully' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_paired',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"city":"Hangzhou"}',
            },
          },
          {
            id: 'call_orphan',
            type: 'function',
            function: {
              name: 'get_news',
              arguments: '{"topic":"AI"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        content: '{"temp":22}',
        tool_call_id: 'call_paired',
      },
    ];

    const result = await convertOpenAIResponseInputs(messages, { strictToolPairing: true });

    expect(result).toEqual([
      { role: 'user', content: 'Use tools carefully' },
      {
        arguments: '{"city":"Hangzhou"}',
        call_id: 'call_paired',
        name: 'get_weather',
        type: 'function_call',
      },
      {
        call_id: 'call_paired',
        output: '{"temp":22}',
        type: 'function_call_output',
      },
    ]);
  });

  it('should drop assistant message with all orphaned tool_calls in strict mode', async () => {
    const messages: OpenAIChatMessage[] = [
      { role: 'user', content: 'Do something' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_orphan_1',
            type: 'function',
            function: { name: 'fn_a', arguments: '{}' },
          },
          {
            id: 'call_orphan_2',
            type: 'function',
            function: { name: 'fn_b', arguments: '{}' },
          },
        ],
      },
      { role: 'assistant', content: 'Final answer' },
    ];

    const result = await convertOpenAIResponseInputs(messages, { strictToolPairing: true });

    // The assistant message with all-orphaned tool_calls should produce no items,
    // NOT fall through to the default builder which would spread tool_calls back.
    expect(result).toEqual([
      { role: 'user', content: 'Do something' },
      { role: 'assistant', content: 'Final answer' },
    ]);
  });

  it('should extract reasoning.content into a separate reasoning item', async () => {
    const messages: OpenAIChatMessage[] = [
      { content: 'system prompts', role: 'system' },
      { content: '你好', role: 'user' },
      {
        content: 'hello',
        role: 'assistant',
        reasoning: { content: 'reasoning content', duration: 2706 },
      },
      { content: '杭州天气如何', role: 'user' },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      { content: 'system prompts', role: 'developer' },
      { content: '你好', role: 'user' },
      { summary: [{ text: 'reasoning content', type: 'summary_text' }], type: 'reasoning' },
      { content: 'hello', role: 'assistant' },
      { content: '杭州天气如何', role: 'user' },
    ]);
  });

  it('should replay encrypted reasoning from a persisted message for the exact scope', async () => {
    const reasoningSignatureScope: SignatureScope = { fingerprint: 'a'.repeat(32) };
    const messages: OpenAIChatMessage[] = [
      {
        content: 'hello',
        model: 'gpt-5.6-sol',
        provider: 'chatgpt',
        reasoning: {
          content: 'reasoning content',
          signature: serializeScopedSignature(
            'encrypted-reasoning-content',
            reasoningSignatureScope,
            'reasoning',
          ),
        },
        role: 'assistant',
      },
    ];

    const result = await convertOpenAIResponseInputs(messages, { reasoningSignatureScope });

    expect(result).toEqual([
      {
        encrypted_content: 'encrypted-reasoning-content',
        summary: [{ text: 'reasoning content', type: 'summary_text' }],
        type: 'reasoning',
      },
      { content: 'hello', role: 'assistant' },
    ]);
  });

  it('should preserve encrypted reasoning content without a visible summary', async () => {
    const reasoningSignatureScope: SignatureScope = { fingerprint: 'a'.repeat(32) };
    const messages: OpenAIChatMessage[] = [
      {
        content: 'hello',
        provider: 'chatgpt',
        reasoning: {
          signature: serializeScopedSignature(
            'encrypted-reasoning-content',
            reasoningSignatureScope,
            'reasoning',
          ),
        },
        role: 'assistant',
      },
    ];

    const result = await convertOpenAIResponseInputs(messages, { reasoningSignatureScope });

    expect(result).toEqual([
      {
        encrypted_content: 'encrypted-reasoning-content',
        summary: [],
        type: 'reasoning',
      },
      { content: 'hello', role: 'assistant' },
    ]);
  });

  it('should keep the visible summary but reject foreign and legacy encrypted reasoning', async () => {
    const sourceScope: SignatureScope = { fingerprint: 'a'.repeat(32) };
    const targetScope: SignatureScope = { fingerprint: 'b'.repeat(32) };
    const baseMessage: OpenAIChatMessage = {
      content: 'hello',
      reasoning: {
        content: 'reasoning content',
        signature: serializeScopedSignature(
          'encrypted-reasoning-content',
          sourceScope,
          'reasoning',
        ),
      },
      role: 'assistant',
    };

    const foreignResult = await convertOpenAIResponseInputs([baseMessage], {
      reasoningSignatureScope: targetScope,
    });
    const legacyResult = await convertOpenAIResponseInputs(
      [{ ...baseMessage, reasoning: { ...baseMessage.reasoning, signature: 'legacy-signature' } }],
      { reasoningSignatureScope: sourceScope },
    );

    const expected = [
      { summary: [{ text: 'reasoning content', type: 'summary_text' }], type: 'reasoning' },
      { content: 'hello', role: 'assistant' },
    ];
    expect(foreignResult).toEqual(expected);
    expect(legacyResult).toEqual(expected);
  });

  it('should replay complete reasoning items in original order for the exact scope', async () => {
    const reasoningSignatureScope: SignatureScope = { fingerprint: 'a'.repeat(32) };
    const messages: OpenAIChatMessage[] = [
      {
        content: 'hello',
        provider: 'chatgpt',
        reasoning: {
          content: 'first summary',
          responseItems: [
            {
              encrypted_content: serializeScopedSignature(
                'encrypted-part-1',
                reasoningSignatureScope,
                'reasoning',
              ),
              id: 'rs_1',
              status: 'completed',
              summary: [{ text: 'first summary', type: 'summary_text' }],
              type: 'reasoning',
            },
            {
              encrypted_content: serializeScopedSignature(
                'encrypted-part-2',
                reasoningSignatureScope,
                'reasoning',
              ),
              id: 'rs_2',
              status: 'completed',
              summary: [],
              type: 'reasoning',
            },
          ],
        },
        role: 'assistant',
      },
    ];

    const result = await convertOpenAIResponseInputs(messages, { reasoningSignatureScope });

    expect(result).toEqual([
      {
        encrypted_content: 'encrypted-part-1',
        id: 'rs_1',
        status: 'completed',
        summary: [{ text: 'first summary', type: 'summary_text' }],
        type: 'reasoning',
      },
      {
        encrypted_content: 'encrypted-part-2',
        id: 'rs_2',
        status: 'completed',
        summary: [],
        type: 'reasoning',
      },
      { content: 'hello', role: 'assistant' },
    ]);
  });

  it('should replay hidden reasoning items that have no visible summary', async () => {
    const reasoningSignatureScope: SignatureScope = { fingerprint: 'a'.repeat(32) };
    const messages: OpenAIChatMessage[] = [
      {
        content: 'hello',
        provider: 'chatgpt',
        reasoning: {
          responseItems: [
            {
              encrypted_content: serializeScopedSignature(
                'hidden-encrypted',
                reasoningSignatureScope,
                'reasoning',
              ),
              id: 'rs_hidden',
              summary: [],
              type: 'reasoning',
            },
          ],
        },
        role: 'assistant',
      },
    ];

    const result = await convertOpenAIResponseInputs(messages, { reasoningSignatureScope });

    expect(result).toEqual([
      {
        encrypted_content: 'hidden-encrypted',
        id: 'rs_hidden',
        summary: [],
        type: 'reasoning',
      },
      { content: 'hello', role: 'assistant' },
    ]);
  });

  it('should fall back to the visible summary when any reasoning item is foreign-scoped', async () => {
    const sourceScope: SignatureScope = { fingerprint: 'a'.repeat(32) };
    const targetScope: SignatureScope = { fingerprint: 'b'.repeat(32) };
    const messages: OpenAIChatMessage[] = [
      {
        content: 'hello',
        provider: 'chatgpt',
        reasoning: {
          content: 'visible summary',
          responseItems: [
            {
              encrypted_content: serializeScopedSignature(
                'encrypted-part-1',
                sourceScope,
                'reasoning',
              ),
              id: 'rs_1',
              summary: [{ text: 'visible summary', type: 'summary_text' }],
              type: 'reasoning',
            },
          ],
          signature: serializeScopedSignature('encrypted-part-1', sourceScope, 'reasoning'),
        },
        role: 'assistant',
      },
    ];

    const result = await convertOpenAIResponseInputs(messages, {
      reasoningSignatureScope: targetScope,
    });

    expect(result).toEqual([
      { summary: [{ text: 'visible summary', type: 'summary_text' }], type: 'reasoning' },
      { content: 'hello', role: 'assistant' },
    ]);
  });

  it('should strip item ids when replaying summary-only reasoning items', async () => {
    const messages: OpenAIChatMessage[] = [
      {
        content: 'hello',
        provider: 'chatgpt',
        reasoning: {
          content: 'summary only',
          responseItems: [
            {
              id: 'rs_summary_only',
              summary: [{ text: 'summary only', type: 'summary_text' }],
              type: 'reasoning',
            },
          ],
        },
        role: 'assistant',
      },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      { summary: [{ text: 'summary only', type: 'summary_text' }], type: 'reasoning' },
      { content: 'hello', role: 'assistant' },
    ]);
  });

  it('should preserve message order when earlier messages have async content (images)', async () => {
    const messages: OpenAIChatMessage[] = [
      { content: 'system prompts', role: 'system' },
      {
        content: [
          { type: 'text', text: 'describe this image' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abc123' } },
        ],
        role: 'user',
      },
      {
        content: 'The image shows a green car.',
        role: 'assistant',
        reasoning: { content: 'analyzing the image', duration: 3000 },
      },
      { content: '1 + 1 = ?', role: 'user' },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      { content: 'system prompts', role: 'developer' },
      {
        content: [
          { type: 'input_text', text: 'describe this image' },
          { type: 'input_image', image_url: 'data:image/jpeg;base64,abc123' },
        ],
        role: 'user',
      },
      { summary: [{ text: 'analyzing the image', type: 'summary_text' }], type: 'reasoning' },
      { content: 'The image shows a green car.', role: 'assistant' },
      { content: '1 + 1 = ?', role: 'user' },
    ]);
  });

  it('should handle openai and claude mixed message', async () => {
    // See: https://github.com/lobehub/lobehub/pull/12017
    const messages: OpenAIChatMessage[] = [
      {
        content: 'system prompts',
        role: 'system',
      },
      {
        content: '你是谁',
        role: 'user',
      },
      {
        content: [
          {
            signature: 'E',
            thinking: 'thoughts',
            type: 'thinking',
          },
          {
            text: '我是 Claude',
            type: 'text',
          },
        ],
        provider: 'anthropic',
        role: 'assistant',
        reasoning: {
          content: 'The user is asking',
          duration: 110,
          signature: 'E',
        },
      },
    ];
    const result = await convertOpenAIResponseInputs(messages, { provider: 'chatgpt' });
    expect(result).toEqual([
      { content: 'system prompts', role: 'developer' },
      { content: '你是谁', role: 'user' },
      {
        summary: [{ text: 'The user is asking', type: 'summary_text' }],
        type: 'reasoning',
      },
      {
        content: [{ text: '我是 Claude', type: 'output_text' }],
        role: 'assistant',
      },
    ]);
  });

  it('should drop assistant image content for Responses API input', async () => {
    const messages: OpenAIChatMessage[] = [
      {
        content: [
          {
            image_url: { url: 'data:image/jpeg;base64,abc123' },
            type: 'image_url',
          },
        ],
        role: 'assistant',
      },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([]);
  });

  it('should keep assistant text and drop unsupported assistant media for Responses API input', async () => {
    const messages: OpenAIChatMessage[] = [
      {
        content: [
          {
            text: 'Here is the generated image.',
            type: 'text',
          },
          {
            image_url: { url: 'data:image/jpeg;base64,abc123' },
            type: 'image_url',
          },
          {
            video_url: { url: 'data:video/mp4;base64,def456' },
            type: 'video_url',
          },
        ],
        role: 'assistant',
      },
    ];

    const result = await convertOpenAIResponseInputs(messages);

    expect(result).toEqual([
      {
        content: [{ text: 'Here is the generated image.', type: 'output_text' }],
        role: 'assistant',
      },
    ]);
  });

  it('should pass forceVideoBase64 to convertMessageContent in video_url branch', async () => {
    process.env.LLM_VISION_VIDEO_USE_BASE64 = undefined;

    const messages: OpenAIChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Here is a video' },
          {
            type: 'video_url',
            video_url: {
              url: 'https://example.com/video.mp4',
            },
          },
        ],
      },
    ];

    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
    vi.mocked(videoUrlToBase64).mockResolvedValue({
      base64: 'forcedBase64',
      mimeType: 'video/mp4',
    });

    const result = await convertOpenAIResponseInputs(messages, { forceVideoBase64: true });

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Here is a video' },
          {
            type: 'input_video',
            video_url: 'data:video/mp4;base64,forcedBase64',
          },
        ],
      },
    ]);

    expect(videoUrlToBase64).toHaveBeenCalledWith('https://example.com/video.mp4');
  });

  it('should pass forceImageBase64 to convertMessageContent in image_url branch', async () => {
    process.env.LLM_VISION_IMAGE_USE_BASE64 = undefined;

    const messages: OpenAIChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Here is an image' },
          {
            type: 'image_url',
            image_url: {
              url: 'https://example.com/image.jpg',
            },
          },
        ],
      },
    ];

    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
    vi.mocked(imageUrlToBase64).mockResolvedValue({
      base64: 'forcedBase64',
      mimeType: 'image/jpeg',
    });

    const result = await convertOpenAIResponseInputs(messages, { forceImageBase64: true });

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Here is an image' },
          {
            type: 'input_image',
            image_url: 'data:image/jpeg;base64,forcedBase64',
          },
        ],
      },
    ]);

    expect(imageUrlToBase64).toHaveBeenCalledWith('https://example.com/image.jpg');
  });
});
