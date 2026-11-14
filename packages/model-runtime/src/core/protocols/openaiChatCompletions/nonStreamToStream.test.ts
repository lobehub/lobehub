// @vitest-environment node
import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';

import { transformResponseToStream } from './nonStreamToStream';

describe('nonStreamToStream', () => {
  describe('transformResponseToStream', () => {
    it('should transform ChatCompletion to stream events correctly', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-3.5-turbo',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello! How can I help you today?',
              refusal: null,
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 13,
          completion_tokens: 7,
          total_tokens: 20,
        },
      };

      const stream = transformResponseToStream(mockResponse);
      const reader = stream.getReader();
      const chunks: OpenAI.ChatCompletionChunk[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toEqual([
        // First chunk: content chunk
        {
          choices: [
            {
              delta: {
                content: 'Hello! How can I help you today?',
                role: 'assistant',
                tool_calls: undefined,
              },
              finish_reason: null,
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-123',
          model: 'gpt-3.5-turbo',
          object: 'chat.completion.chunk',
        },
        // Second chunk: usage chunk
        {
          choices: [],
          created: 1677652288,
          id: 'chatcmpl-123',
          model: 'gpt-3.5-turbo',
          object: 'chat.completion.chunk',
          usage: {
            prompt_tokens: 13,
            completion_tokens: 7,
            total_tokens: 20,
          },
        },
        // Third chunk: finish chunk
        {
          choices: [
            {
              delta: {
                content: null,
                role: 'assistant',
              },
              finish_reason: 'stop',
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-123',
          model: 'gpt-3.5-turbo',
          object: 'chat.completion.chunk',
          system_fingerprint: undefined,
        },
      ]);
    });

    it('should transform ChatCompletion with reasoning_content to stream events correctly', async () => {
      const mockResponse: unknown = {
        id: 'chatcmpl-reasoning-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'deepseek-reasoner',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'The answer is 42.',
              reasoning_content: 'Let me think about this step by step...',
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 13,
          completion_tokens: 7,
          total_tokens: 20,
        },
      };

      const stream = transformResponseToStream(mockResponse as OpenAI.ChatCompletion);
      const reader = stream.getReader();
      const chunks: OpenAI.ChatCompletionChunk[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toEqual([
        // First chunk: reasoning chunk
        {
          choices: [
            {
              delta: {
                content: null,
                reasoning_content: 'Let me think about this step by step...',
                role: 'assistant',
              },
              finish_reason: null,
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-reasoning-123',
          model: 'deepseek-reasoner',
          object: 'chat.completion.chunk',
        },
        // Second chunk: content chunk
        {
          choices: [
            {
              delta: {
                content: 'The answer is 42.',
                role: 'assistant',
                tool_calls: undefined,
              },
              finish_reason: null,
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-reasoning-123',
          model: 'deepseek-reasoner',
          object: 'chat.completion.chunk',
        },
        // Third chunk: usage chunk
        {
          choices: [],
          created: 1677652288,
          id: 'chatcmpl-reasoning-123',
          model: 'deepseek-reasoner',
          object: 'chat.completion.chunk',
          usage: {
            prompt_tokens: 13,
            completion_tokens: 7,
            total_tokens: 20,
          },
        },
        // Fourth chunk: finish chunk
        {
          choices: [
            {
              delta: {
                content: null,
                role: 'assistant',
              },
              finish_reason: 'stop',
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-reasoning-123',
          model: 'deepseek-reasoner',
          object: 'chat.completion.chunk',
          system_fingerprint: undefined,
        },
      ]);
    });

    it('should transform ChatCompletion with tool_calls to stream events correctly', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'chatcmpl-tool-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-4',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'I need to check the weather for you.',
              refusal: null,
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location": "New York"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 13,
          completion_tokens: 7,
          total_tokens: 20,
        },
      };

      const stream = transformResponseToStream(mockResponse);
      const reader = stream.getReader();
      const chunks: OpenAI.ChatCompletionChunk[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toEqual([
        // First chunk: content and tool_calls chunk
        {
          choices: [
            {
              delta: {
                content: 'I need to check the weather for you.',
                role: 'assistant',
                tool_calls: [
                  {
                    function: {
                      name: 'get_weather',
                      arguments: '{"location": "New York"}',
                    },
                    id: 'call_abc123',
                    index: 0,
                    type: 'function',
                  },
                ],
              },
              finish_reason: null,
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-tool-123',
          model: 'gpt-4',
          object: 'chat.completion.chunk',
        },
        // Second chunk: usage chunk
        {
          choices: [],
          created: 1677652288,
          id: 'chatcmpl-tool-123',
          model: 'gpt-4',
          object: 'chat.completion.chunk',
          usage: {
            prompt_tokens: 13,
            completion_tokens: 7,
            total_tokens: 20,
          },
        },
        // Third chunk: finish chunk
        {
          choices: [
            {
              delta: {
                content: null,
                role: 'assistant',
              },
              finish_reason: 'tool_calls',
              index: 0,
              logprobs: null,
            },
          ],
          created: 1677652288,
          id: 'chatcmpl-tool-123',
          model: 'gpt-4',
          object: 'chat.completion.chunk',
          system_fingerprint: undefined,
        },
      ]);
    });

    it('should handle empty choices array', async () => {
      const mockResponse: OpenAI.ChatCompletion = {
        id: 'chatcmpl-empty-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-3.5-turbo',
        choices: [],
        usage: {
          prompt_tokens: 13,
          completion_tokens: 0,
          total_tokens: 13,
        },
      };

      const stream = transformResponseToStream(mockResponse);
      const reader = stream.getReader();
      const chunks: OpenAI.ChatCompletionChunk[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      expect(chunks).toHaveLength(3);

      // Verify all chunks have empty choices array structure
      expect(chunks[0].choices).toEqual([]);
      expect(chunks[1]).toEqual({
        choices: [],
        created: 1677652288,
        id: 'chatcmpl-empty-123',
        model: 'gpt-3.5-turbo',
        object: 'chat.completion.chunk',
        usage: {
          prompt_tokens: 13,
          completion_tokens: 0,
          total_tokens: 13,
        },
      });
      expect(chunks[2].choices).toEqual([]);
    });
  });
});
