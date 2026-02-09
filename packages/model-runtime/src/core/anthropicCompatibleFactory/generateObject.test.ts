// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createAnthropicGenerateObject } from './generateObject';

describe('Anthropic generateObject', () => {
  it('should throw error when neither tools nor schema is provided', async () => {
    const mockClient = {
      messages: {
        create: vi.fn(),
      },
    };

    const payload = {
      messages: [{ content: 'Generate data', role: 'user' as const }],
      model: 'claude-3-5-sonnet-20241022',
    };

    await expect(createAnthropicGenerateObject(mockClient as any, payload as any)).rejects.toThrow(
      'tools or schema is required',
    );
  });

  describe('use struct output schema', () => {
    it('should return structured data on successful API call', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                input: { age: 30, name: 'John' },
                name: 'person_extractor',
                type: 'tool_use',
              },
            ],
          }),
        },
      };

      const payload = {
        messages: [{ content: 'Generate a person object', role: 'user' as const }],
        model: 'claude-3-5-sonnet-20241022',
        schema: {
          description: 'Extract person information',
          name: 'person_extractor',
          schema: {
            properties: { age: { type: 'number' }, name: { type: 'string' } },
            required: ['name', 'age'],
            type: 'object' as const,
          },
        },
      };

      const result = await createAnthropicGenerateObject(mockClient as any, payload);

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 8192,
          messages: [{ content: 'Generate a person object', role: 'user' }],
          model: 'claude-3-5-sonnet-20241022',
          tool_choice: {
            name: 'person_extractor',
            type: 'tool',
          },
          tools: [
            {
              description: 'Extract person information',
              input_schema: {
                properties: {
                  age: { type: 'number' },
                  name: { type: 'string' },
                },
                required: ['name', 'age'],
                type: 'object',
              },
              name: 'person_extractor',
            },
          ],
        }),
        expect.objectContaining({}),
      );

      expect(result).toEqual({ age: 30, name: 'John' });
    });

    it('should handle system messages correctly', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                input: { status: 'success' },
                name: 'status_extractor',
                type: 'tool_use',
              },
            ],
          }),
        },
      };

      const payload = {
        messages: [
          { content: 'You are a helpful assistant', role: 'system' as const },
          { content: 'Generate status', role: 'user' as const },
        ],
        model: 'claude-3-5-sonnet-20241022',
        schema: {
          name: 'status_extractor',
          schema: { properties: { status: { type: 'string' } }, type: 'object' as const },
        },
      };

      const result = await createAnthropicGenerateObject(mockClient as any, payload);

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.any(Array),
          system: [{ text: 'You are a helpful assistant', type: 'text' }],
        }),
        expect.any(Object),
      );

      expect(result).toEqual({ status: 'success' });
    });

    it('should handle options correctly', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                input: { data: 'test' },
                name: 'data_extractor',
                type: 'tool_use',
              },
            ],
          }),
        },
      };

      const payload = {
        messages: [{ content: 'Generate data', role: 'user' as const }],
        model: 'claude-3-5-sonnet-20241022',
        schema: {
          name: 'data_extractor',
          schema: { properties: { data: { type: 'string' } }, type: 'object' as const },
        },
      };

      const options = {
        signal: new AbortController().signal,
      };

      const result = await createAnthropicGenerateObject(mockClient as any, payload, options);

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          signal: options.signal,
        }),
      );

      expect(result).toEqual({ data: 'test' });
    });

    it('should return undefined when no tool use found in response', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                text: 'Some text response without tool use',
                type: 'text',
              },
            ],
          }),
        },
      };

      const payload = {
        messages: [{ content: 'Generate data', role: 'user' as const }],
        model: 'claude-3-5-sonnet-20241022',
        schema: {
          name: 'test_tool',
          schema: { type: 'object' },
        },
      };

      const result = await createAnthropicGenerateObject(mockClient as any, payload as any);

      expect(result).toBeUndefined();
    });

    it('should handle complex nested schemas', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                input: {
                  metadata: {
                    created: '2024-01-01',
                  },
                  user: {
                    name: 'Alice',
                    profile: {
                      age: 25,
                      preferences: ['music', 'sports'],
                    },
                  },
                },
                name: 'user_extractor',
                type: 'tool_use',
              },
            ],
          }),
        },
      };

      const payload = {
        messages: [{ content: 'Generate complex user data', role: 'user' as const }],
        model: 'claude-3-5-sonnet-20241022',
        schema: {
          description: 'Extract complex user information',
          name: 'user_extractor',
          schema: {
            properties: {
              metadata: { type: 'object' },
              user: {
                properties: {
                  name: { type: 'string' },
                  profile: {
                    properties: {
                      age: { type: 'number' },
                      preferences: { items: { type: 'string' }, type: 'array' },
                    },
                    type: 'object',
                  },
                },
                type: 'object',
              },
            },
            type: 'object' as const,
          },
        },
      };

      const result = await createAnthropicGenerateObject(mockClient as any, payload);

      expect(result).toEqual({
        metadata: {
          created: '2024-01-01',
        },
        user: {
          name: 'Alice',
          profile: {
            age: 25,
            preferences: ['music', 'sports'],
          },
        },
      });
    });
  });

  describe('tools calling', () => {
    it('should handle tools calling mode with multiple tools', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                input: { city: 'New York', unit: 'celsius' },
                name: 'get_weather',
                type: 'tool_use',
              },
              {
                input: { timezone: 'America/New_York' },
                name: 'get_time',
                type: 'tool_use',
              },
            ],
          }),
        },
      };

      const payload = {
        messages: [{ content: 'What is the weather and time in New York?', role: 'user' as const }],
        model: 'claude-3-5-sonnet-20241022',
        tools: [
          {
            function: {
              description: 'Get weather information',
              name: 'get_weather',
              parameters: {
                properties: {
                  city: { type: 'string' },
                  unit: { type: 'string' },
                },
                required: ['city'],
                type: 'object' as const,
              },
            },
            type: 'function' as const,
          },
          {
            function: {
              description: 'Get current time',
              name: 'get_time',
              parameters: {
                properties: {
                  timezone: { type: 'string' },
                },
                required: ['timezone'],
                type: 'object' as const,
              },
            },
            type: 'function' as const,
          },
        ],
      };

      const result = await createAnthropicGenerateObject(mockClient as any, payload as any);

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 8192,
          messages: [{ content: 'What is the weather and time in New York?', role: 'user' }],
          model: 'claude-3-5-sonnet-20241022',
          tool_choice: {
            type: 'any',
          },
          tools: [
            {
              description: 'Get weather information',
              input_schema: {
                properties: {
                  city: { type: 'string' },
                  unit: { type: 'string' },
                },
                required: ['city'],
                type: 'object',
              },
              name: 'get_weather',
            },
            {
              description: 'Get current time',
              input_schema: {
                properties: {
                  timezone: { type: 'string' },
                },
                required: ['timezone'],
                type: 'object',
              },
              name: 'get_time',
            },
          ],
        }),
        expect.objectContaining({}),
      );

      expect(result).toEqual([
        { arguments: { city: 'New York', unit: 'celsius' }, name: 'get_weather' },
        { arguments: { timezone: 'America/New_York' }, name: 'get_time' },
      ]);
    });

    it('should handle tools calling mode with single tool', async () => {
      const mockClient = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                input: { a: 5, b: 3, operation: 'add' },
                name: 'calculate',
                type: 'tool_use',
              },
            ],
          }),
        },
      };

      const payload = {
        messages: [{ content: 'Add 5 and 3', role: 'user' as const }],
        model: 'claude-3-5-sonnet-20241022',
        tools: [
          {
            function: {
              description: 'Perform mathematical calculation',
              name: 'calculate',
              parameters: {
                properties: {
                  a: { type: 'number' },
                  b: { type: 'number' },
                  operation: { type: 'string' },
                },
                required: ['operation', 'a', 'b'],
                type: 'object' as const,
              },
            },
            type: 'function' as const,
          },
        ],
      };

      const result = await createAnthropicGenerateObject(mockClient as any, payload as any);

      expect(result).toEqual([{ arguments: { a: 5, b: 3, operation: 'add' }, name: 'calculate' }]);
    });
  });

  it('should propagate API errors correctly', async () => {
    const apiError = new Error('API Error: Model not found');

    const mockClient = {
      messages: {
        create: vi.fn().mockRejectedValue(apiError),
      },
    };

    const payload = {
      messages: [{ content: 'Generate data', role: 'user' as const }],
      model: 'claude-3-5-sonnet-20241022',
      schema: {
        name: 'test_tool',
        schema: { type: 'object' },
      },
    };

    await expect(createAnthropicGenerateObject(mockClient as any, payload as any)).rejects.toThrow(
      'API Error: Model not found',
    );
  });

  it('should handle abort signals correctly', async () => {
    const apiError = new Error('Request was cancelled');
    apiError.name = 'AbortError';

    const mockClient = {
      messages: {
        create: vi.fn().mockRejectedValue(apiError),
      },
    };

    const payload = {
      messages: [{ content: 'Generate data', role: 'user' as const }],
      model: 'claude-3-5-sonnet-20241022',
      schema: {
        name: 'test_tool',
        schema: { type: 'object' },
      },
    };

    const options = {
      signal: new AbortController().signal,
    };

    await expect(
      createAnthropicGenerateObject(mockClient as any, payload as any, options),
    ).rejects.toThrow();
  });
});
