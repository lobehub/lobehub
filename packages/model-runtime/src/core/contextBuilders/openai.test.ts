import { imageUrlToBase64, videoUrlToBase64 } from '@lobechat/utils';
import type OpenAI from 'openai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenAIChatMessage } from '../../types';
import { parseDataUri } from '../../utils/uriParser';
import {
  convertImageUrlToFile,
  convertMessageContent,
  convertOpenAIMessages,
  convertOpenAIResponseInputs,
  type ExtendedChatCompletionContentPart,
} from './openai';

// 模拟依赖
vi.mock('@lobechat/utils', () => ({
  imageUrlToBase64: vi.fn(),
  videoUrlToBase64: vi.fn(),
}));
vi.mock('../../utils/uriParser');

describe('convertMessageContent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return the same content if not image_url type', async () => {
    const content = { type: 'text', text: 'Hello' } as OpenAI.ChatCompletionContentPart;
    const result = await convertMessageContent(content);
    expect(result).toEqual(content);
  });

  it('should convert image URL to base64 when necessary', async () => {
    // 设置环境变量
    process.env.LLM_VISION_IMAGE_USE_BASE64 = '1';

    const content = {
      type: 'image_url',
      image_url: { url: 'https://example.com/image.jpg' },
    } as OpenAI.ChatCompletionContentPart;

    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
    vi.mocked(imageUrlToBase64).mockResolvedValue({
      base64: 'base64String',
      mimeType: 'image/jpeg',
    });

    const result = await convertMessageContent(content);

    expect(result).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,base64String' },
    });

    expect(parseDataUri).toHaveBeenCalledWith('https://example.com/image.jpg');
    expect(imageUrlToBase64).toHaveBeenCalledWith('https://example.com/image.jpg');
  });

  it('should not convert image URL when not necessary', async () => {
    process.env.LLM_VISION_IMAGE_USE_BASE64 = undefined;

    const content = {
      type: 'image_url',
      image_url: { url: 'https://example.com/image.jpg' },
    } as OpenAI.ChatCompletionContentPart;

    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });

    const result = await convertMessageContent(content);

    expect(result).toEqual(content);
    expect(imageUrlToBase64).not.toHaveBeenCalled();
  });

  it('should convert image URL when forceImageBase64 is true', async () => {
    process.env.LLM_VISION_IMAGE_USE_BASE64 = undefined;

    const content = {
      type: 'image_url',
      image_url: { url: 'https://example.com/image.jpg' },
    } as OpenAI.ChatCompletionContentPart;

    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
    vi.mocked(imageUrlToBase64).mockResolvedValue({
      base64: 'forcedBase64',
      mimeType: 'image/jpeg',
    });

    const result = await convertMessageContent(content, { forceImageBase64: true });

    expect(result).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,forcedBase64' },
    });

    expect(imageUrlToBase64).toHaveBeenCalledWith('https://example.com/image.jpg');
  });

  it('should convert video URL to base64 when necessary', async () => {
    process.env.LLM_VISION_VIDEO_USE_BASE64 = '1';

    const content: ExtendedChatCompletionContentPart = {
      type: 'video_url',
      video_url: { url: 'https://example.com/video.mp4' },
    };

    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
    vi.mocked(videoUrlToBase64).mockResolvedValue({
      base64: 'base64String',
      mimeType: 'video/mp4',
    });

    const result = await convertMessageContent(content);

    expect(result).toEqual({
      type: 'video_url',
      video_url: { url: 'data:video/mp4;base64,base64String' },
    });

    expect(parseDataUri).toHaveBeenCalledWith('https://example.com/video.mp4');
    expect(videoUrlToBase64).toHaveBeenCalledWith('https://example.com/video.mp4');

    process.env.LLM_VISION_VIDEO_USE_BASE64 = undefined;
  });

  it('should not convert video URL when not necessary', async () => {
    process.env.LLM_VISION_VIDEO_USE_BASE64 = undefined;

    const content: ExtendedChatCompletionContentPart = {
      type: 'video_url',
      video_url: { url: 'https://example.com/video.mp4' },
    };

    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });

    const result = await convertMessageContent(content);

    expect(result).toEqual(content);
    expect(videoUrlToBase64).not.toHaveBeenCalled();
  });

  it('should convert video URL when forceVideoBase64 is true', async () => {
    process.env.LLM_VISION_VIDEO_USE_BASE64 = undefined;

    const content: ExtendedChatCompletionContentPart = {
      type: 'video_url',
      video_url: { url: 'https://example.com/video.mp4' },
    };

    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
    vi.mocked(videoUrlToBase64).mockResolvedValue({
      base64: 'forcedBase64',
      mimeType: 'video/mp4',
    });

    const result = await convertMessageContent(content, { forceVideoBase64: true });

    expect(result).toEqual({
      type: 'video_url',
      video_url: { url: 'data:video/mp4;base64,forcedBase64' },
    });

    expect(videoUrlToBase64).toHaveBeenCalledWith('https://example.com/video.mp4');
  });

  it('should return original content when video conversion fails', async () => {
    process.env.LLM_VISION_VIDEO_USE_BASE64 = '1';

    const content: ExtendedChatCompletionContentPart = {
      type: 'video_url',
      video_url: { url: 'https://example.com/video.mp4' },
    };

    vi.mocked(parseDataUri).mockReturnValue({ type: 'url', base64: null, mimeType: null });
    vi.mocked(videoUrlToBase64).mockRejectedValue(new Error('Conversion failed'));

    const result = await convertMessageContent(content);

    expect(result).toEqual(content);

    process.env.LLM_VISION_VIDEO_USE_BASE64 = undefined;
  });
});

describe('convertOpenAIMessages', () => {
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
});

describe('convertOpenAIResponseInputs', () => {
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
        role: 'assistant',
        reasoning: {
          content: 'The user is asking',
          duration: 110,
          // @ts-expect-error: ignore
          signature: 'E',
        },
      },
    ];
    const result = await convertOpenAIResponseInputs(messages);
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

describe('convertImageUrlToFile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Data URL handling', () => {
    it('should convert PNG data URL to File object correctly', async () => {
      const base64Data =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      const dataUrl = `data:image/png;base64,${base64Data}`;

      const result = await convertImageUrlToFile(dataUrl);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('name', 'image.png');
      expect(result).toHaveProperty('type', 'image/png');
      expect(result).toHaveProperty('size');
      expect(result.size).toBeGreaterThan(0);
    });

    it('should convert JPEG data URL to File object correctly', async () => {
      const base64Data =
        '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA9BQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
      const dataUrl = `data:image/jpeg;base64,${base64Data}`;

      const result = await convertImageUrlToFile(dataUrl);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('name', 'image.jpeg');
      expect(result).toHaveProperty('type', 'image/jpeg');
      expect(result).toHaveProperty('size');
      expect(result.size).toBeGreaterThan(0);
    });

    it('should convert WebP data URL to File object correctly', async () => {
      const base64Data = 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAAAAJaQAA6g=';
      const dataUrl = `data:image/webp;base64,${base64Data}`;

      const result = await convertImageUrlToFile(dataUrl);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('name', 'image.webp');
      expect(result).toHaveProperty('type', 'image/webp');
      expect(result).toHaveProperty('size');
      expect(result.size).toBeGreaterThan(0);
    });
  });

  describe('HTTP URL handling', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      // Mock global fetch using vi.stubGlobal for better isolation
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    });

    it('should convert HTTP URL to File object correctly', async () => {
      const mockArrayBuffer = new ArrayBuffer(8);
      const mockHeaders = new Headers();
      mockHeaders.set('content-type', 'image/jpeg');

      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
        headers: mockHeaders,
      } satisfies Partial<Response>);

      const result = await convertImageUrlToFile('https://example.com/image.jpg');

      expect(mockFetch).toHaveBeenCalledWith('https://example.com/image.jpg');
      expect(result).toBeDefined();
      expect(result).toHaveProperty('name', 'image.jpeg');
      expect(result).toHaveProperty('type', 'image/jpeg');
      expect(result).toHaveProperty('size');
      expect(result.size).toEqual(8);
    });

    it('should handle different content types from HTTP response headers', async () => {
      const testCases = [
        { contentType: 'image/jpeg', expectedExtension: 'jpeg' },
        { contentType: 'image/png', expectedExtension: 'png' },
        { contentType: 'image/webp', expectedExtension: 'webp' },
        { contentType: null, expectedExtension: 'png' }, // default fallback
      ];

      for (const testCase of testCases) {
        const mockArrayBuffer = new ArrayBuffer(8);
        const mockHeaders = new Headers();
        if (testCase.contentType) {
          mockHeaders.set('content-type', testCase.contentType);
        }

        mockFetch.mockResolvedValue({
          ok: true,
          arrayBuffer: () => Promise.resolve(mockArrayBuffer),
          headers: mockHeaders,
        } satisfies Partial<Response>);

        const result = await convertImageUrlToFile('https://example.com/image.jpg');

        expect(result).toHaveProperty('name', `image.${testCase.expectedExtension}`);
        expect(result).toHaveProperty('type', testCase.contentType || 'image/png');

        vi.clearAllMocks();
      }
    });

    it('should throw error when HTTP request fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
      } satisfies Partial<Response>);

      await expect(convertImageUrlToFile('https://example.com/nonexistent.jpg')).rejects.toThrow(
        'Failed to fetch image from https://example.com/nonexistent.jpg: Not Found',
      );

      expect(mockFetch).toHaveBeenCalledWith('https://example.com/nonexistent.jpg');
    });

    it('should throw error when network request fails', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(convertImageUrlToFile('https://example.com/image.jpg')).rejects.toThrow(
        'Network error',
      );

      expect(mockFetch).toHaveBeenCalledWith('https://example.com/image.jpg');
    });
  });

  describe('Edge cases', () => {
    it('should handle malformed data URL gracefully', async () => {
      const malformedDataUrl = 'data:invalid-format';

      // 这个测试可能会抛出错误，我们需要适当处理
      await expect(convertImageUrlToFile(malformedDataUrl)).rejects.toThrow();
    });
  });
});
