import { describe, expect, it } from 'vitest';

import type { OpenAIChatMessage } from '../../types';
import { convertOpenAIMessagesToHFFormat } from './huggingface';

describe('convertOpenAIMessagesToHFFormat', () => {
  it('should convert simple text messages', () => {
    const messages: OpenAIChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];

    const result = convertOpenAIMessagesToHFFormat(messages);

    expect(result).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]);
  });

  it('should convert messages with name property', () => {
    const messages: OpenAIChatMessage[] = [{ role: 'user', content: 'Hello', name: 'John' }];

    const result = convertOpenAIMessagesToHFFormat(messages);

    expect(result).toEqual([{ role: 'user', content: 'Hello', name: 'John' }]);
  });

  it('should convert text content array to HF format', () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      },
    ];

    const result = convertOpenAIMessagesToHFFormat(messages);

    expect(result).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      },
    ]);
  });

  it('should convert image_url content array to HF format', () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: 'https://example.com/image.jpg',
              detail: 'high',
            },
          },
        ],
      },
    ];

    const result = convertOpenAIMessagesToHFFormat(messages);

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: 'https://example.com/image.jpg',
              detail: 'high',
            },
          },
        ],
      },
    ]);
  });

  it('should convert mixed content array', () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Check this image' },
          {
            type: 'image_url',
            image_url: {
              url: 'https://example.com/image.jpg',
              detail: 'low',
            },
          },
        ],
      },
    ];

    const result = convertOpenAIMessagesToHFFormat(messages);

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Check this image' },
          {
            type: 'image_url',
            image_url: {
              url: 'https://example.com/image.jpg',
              detail: 'low',
            },
          },
        ],
      },
    ]);
  });

  it('should convert messages with tool_calls', () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'assistant',
        content: 'I will call a tool',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"city": "New York"}',
            },
          },
        ],
      },
    ];

    const result = convertOpenAIMessagesToHFFormat(messages);

    expect(result).toEqual([
      {
        role: 'assistant',
        content: 'I will call a tool',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"city": "New York"}',
            },
          },
        ],
      },
    ]);
  });

  it('should convert messages with tool_call_id', () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'tool',
        content: 'Weather data',
        tool_call_id: 'call_123',
      },
    ];

    const result = convertOpenAIMessagesToHFFormat(messages);

    expect(result).toEqual([
      {
        role: 'tool',
        content: 'Weather data',
        tool_call_id: 'call_123',
      },
    ]);
  });

  it('should handle undefined image_url detail', () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: 'https://example.com/image.jpg',
            },
          },
        ],
      },
    ];

    const result = convertOpenAIMessagesToHFFormat(messages);

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: 'https://example.com/image.jpg',
              detail: undefined,
            },
          },
        ],
      },
    ]);
  });

  it('should handle unknown content types with fallback', () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          // @ts-ignore - Testing unknown content type
          { type: 'unknown', data: 'some data' },
        ],
      },
    ];

    const result = convertOpenAIMessagesToHFFormat(messages);

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { text: '', type: 'text' },
        ],
      },
    ]);
  });

  it('should handle empty content array', () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'user',
        content: [],
      },
    ];

    const result = convertOpenAIMessagesToHFFormat(messages);

    expect(result).toEqual([
      {
        role: 'user',
        content: [],
      },
    ]);
  });

  it('should convert multiple messages with different content types', () => {
    const messages: OpenAIChatMessage[] = [
      { role: 'user', content: 'Simple text' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Response with image' },
          {
            type: 'image_url',
            image_url: {
              url: 'https://example.com/response.jpg',
              detail: 'auto',
            },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: 'https://example.com/input.jpg',
            },
          },
        ],
      },
    ];

    const result = convertOpenAIMessagesToHFFormat(messages);

    expect(result).toHaveLength(3);
    expect(result[0].content).toBe('Simple text');
    expect(Array.isArray(result[1].content)).toBe(true);
    expect(Array.isArray(result[2].content)).toBe(true);
  });

  it('should preserve all message properties', () => {
    const messages: OpenAIChatMessage[] = [
      {
        role: 'assistant',
        content: 'Test message',
        name: 'assistant_name',
        tool_calls: [
          {
            id: 'call_456',
            type: 'function',
            function: {
              name: 'test_function',
              arguments: '{}',
            },
          },
        ],
      },
    ];

    const result = convertOpenAIMessagesToHFFormat(messages);

    expect(result[0]).toEqual({
      role: 'assistant',
      content: 'Test message',
      name: 'assistant_name',
      tool_calls: [
        {
          id: 'call_456',
          type: 'function',
          function: {
            name: 'test_function',
            arguments: '{}',
          },
        },
      ],
    });
  });
});
