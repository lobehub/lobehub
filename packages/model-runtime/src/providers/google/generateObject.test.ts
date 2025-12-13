// @vitest-environment node
import { Type as SchemaType } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';

import {
  convertOpenAISchemaToGoogleSchema,
  createGoogleGenerateObject,
  createGoogleGenerateObjectWithTools,
} from './generateObject';

describe('Google generateObject', () => {
  describe('convertOpenAISchemaToGoogleSchema', () => {
    it('should convert basic types correctly', () => {
      const openAISchema = {
        name: 'person',
        schema: {
          properties: {
            age: { type: 'number' },
            count: { type: 'integer' },
            isActive: { type: 'boolean' },
            name: { type: 'string' },
          },
          type: 'object' as const,
        },
      };

      const result = convertOpenAISchemaToGoogleSchema(openAISchema);

      expect(result).toEqual({
        properties: {
          age: { type: SchemaType.NUMBER },
          count: { type: SchemaType.INTEGER },
          isActive: { type: SchemaType.BOOLEAN },
          name: { type: SchemaType.STRING },
        },
        type: SchemaType.OBJECT,
      });
    });

    it('should convert array schemas correctly', () => {
      const openAISchema = {
        name: 'recipes',
        schema: {
          properties: {
            recipes: {
              items: {
                properties: {
                  ingredients: {
                    items: { type: 'string' },
                    type: 'array',
                  },
                  recipeName: { type: 'string' },
                },
                propertyOrdering: ['recipeName', 'ingredients'],
                type: 'object',
              },
              type: 'array',
            },
          },
          type: 'object' as const,
        },
      };

      const result = convertOpenAISchemaToGoogleSchema(openAISchema);

      expect(result).toEqual({
        properties: {
          recipes: {
            items: {
              properties: {
                ingredients: {
                  items: { type: SchemaType.STRING },
                  type: SchemaType.ARRAY,
                },
                recipeName: { type: SchemaType.STRING },
              },
              propertyOrdering: ['recipeName', 'ingredients'],
              type: SchemaType.OBJECT,
            },
            type: SchemaType.ARRAY,
          },
        },
        type: SchemaType.OBJECT,
      });
    });

    it('should handle nested objects', () => {
      const openAISchema = {
        name: 'user_data',
        schema: {
          properties: {
            user: {
              properties: {
                profile: {
                  properties: {
                    preferences: {
                      items: { type: 'string' },
                      type: 'array',
                    },
                  },
                  type: 'object',
                },
              },
              type: 'object',
            },
          },
          type: 'object' as const,
        },
      };

      const result = convertOpenAISchemaToGoogleSchema(openAISchema);

      expect(result).toEqual({
        properties: {
          user: {
            properties: {
              profile: {
                properties: {
                  preferences: {
                    items: { type: SchemaType.STRING },
                    type: SchemaType.ARRAY,
                  },
                },
                type: SchemaType.OBJECT,
              },
            },
            type: SchemaType.OBJECT,
          },
        },
        type: SchemaType.OBJECT,
      });
    });

    it('should preserve additional properties like description, enum, required', () => {
      const openAISchema = {
        name: 'person',
        schema: {
          description: 'A person object',
          properties: {
            status: {
              description: 'The status of the person',
              enum: ['active', 'inactive'],
              type: 'string',
            },
          },
          required: ['status'],
          type: 'object' as const,
        } as any,
      };

      const result = convertOpenAISchemaToGoogleSchema(openAISchema);

      expect(result).toEqual({
        description: 'A person object',
        properties: {
          status: {
            description: 'The status of the person',
            enum: ['active', 'inactive'],
            type: SchemaType.STRING,
          },
        },
        required: ['status'],
        type: SchemaType.OBJECT,
      });
    });

    it('should handle unknown types by defaulting to STRING', () => {
      const openAISchema = {
        name: 'test',
        schema: {
          type: 'unknown-type' as any,
        } as any,
      };

      const result = convertOpenAISchemaToGoogleSchema(openAISchema);

      expect(result).toEqual({
        type: SchemaType.STRING,
      });
    });
  });

  describe('createGoogleGenerateObject', () => {
    it('should return parsed JSON object on successful API call', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: '{"name": "John", "age": 30}',
          }),
        },
      };

      const contents = [{ parts: [{ text: 'Generate a person object' }], role: 'user' }];

      const payload = {
        contents,
        model: 'gemini-2.5-flash',
        schema: {
          name: 'person',
          schema: {
            properties: { age: { type: 'number' }, name: { type: 'string' } },
            type: 'object' as const,
          },
        },
      };

      const result = await createGoogleGenerateObject(mockClient as any, payload);

      expect(mockClient.models.generateContent).toHaveBeenCalledWith({
        config: expect.objectContaining({
          responseMimeType: 'application/json',
          responseSchema: expect.objectContaining({
            properties: expect.objectContaining({
              age: { type: SchemaType.NUMBER },
              name: { type: SchemaType.STRING },
            }),
            type: SchemaType.OBJECT,
          }),
          safetySettings: expect.any(Array),
        }),
        contents,
        model: 'gemini-2.5-flash',
      });

      expect(result).toEqual({ age: 30, name: 'John' });
    });

    it('should handle options correctly', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: '{"status": "success"}',
          }),
        },
      };

      const contents = [{ parts: [{ text: 'Generate status' }], role: 'user' }];

      const payload = {
        contents,
        model: 'gemini-2.5-flash',
        schema: {
          name: 'status',
          schema: {
            properties: { status: { type: 'string' } },
            type: 'object' as const,
          },
        },
      };

      const options = {
        signal: new AbortController().signal,
      };

      const result = await createGoogleGenerateObject(mockClient as any, payload, options);

      expect(mockClient.models.generateContent).toHaveBeenCalledWith({
        config: expect.objectContaining({
          abortSignal: options.signal,
          responseMimeType: 'application/json',
          responseSchema: expect.objectContaining({
            properties: expect.objectContaining({
              status: { type: SchemaType.STRING },
            }),
            type: SchemaType.OBJECT,
          }),
        }),
        contents,
        model: 'gemini-2.5-flash',
      });

      expect(result).toEqual({ status: 'success' });
    });

    it('should return undefined when JSON parsing fails', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: 'invalid json string',
          }),
        },
      };

      const contents: any[] = [];
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const payload = {
        contents,
        model: 'gemini-2.5-flash',
        schema: {
          name: 'test',
          schema: {
            properties: {},
            type: 'object' as const,
          },
        },
      };

      const result = await createGoogleGenerateObject(mockClient as any, payload);

      expect(consoleSpy).toHaveBeenCalledWith('parse json error:', 'invalid json string');
      expect(result).toBeUndefined();

      consoleSpy.mockRestore();
    });

    it('should handle complex nested schemas', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: '{"user": {"name": "Alice", "profile": {"age": 25, "preferences": ["music", "sports"]}}, "metadata": {"created": "2024-01-01"}}',
          }),
        },
      };

      const contents: any[] = [];

      const payload = {
        contents,
        model: 'gemini-2.5-flash',
        schema: {
          name: 'user_data',
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

      const result = await createGoogleGenerateObject(mockClient as any, payload);

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

    it('should propagate API errors correctly', async () => {
      const apiError = new Error('API Error: Model not found');

      const mockClient = {
        models: {
          generateContent: vi.fn().mockRejectedValue(apiError),
        },
      };

      const contents: any[] = [];

      const payload = {
        contents,
        model: 'gemini-2.5-flash',
        schema: {
          name: 'test',
          schema: {
            properties: {},
            type: 'object' as const,
          },
        },
      };

      await expect(createGoogleGenerateObject(mockClient as any, payload)).rejects.toThrow();
    });

    it('should handle abort signals correctly', async () => {
      const apiError = new Error('Request was cancelled');
      apiError.name = 'AbortError';

      const mockClient = {
        models: {
          generateContent: vi.fn().mockRejectedValue(apiError),
        },
      };

      const contents: any[] = [];

      const payload = {
        contents,
        model: 'gemini-2.5-flash',
        schema: {
          name: 'test',
          schema: {
            properties: {},
            type: 'object' as const,
          },
        },
      };

      const options = {
        signal: new AbortController().signal,
      };

      await expect(
        createGoogleGenerateObject(mockClient as any, payload, options),
      ).rejects.toThrow();
    });
  });

  describe('createGoogleGenerateObjectWithTools', () => {
    it('should return function calls on successful API call with tools', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        args: { city: 'New York', unit: 'celsius' },
                        name: 'get_weather',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
      };

      const contents = [{ parts: [{ text: 'What is the weather in New York?' }], role: 'user' }];

      const payload = {
        contents,
        model: 'gemini-2.5-flash',
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
        ],
      };

      const result = await createGoogleGenerateObjectWithTools(mockClient as any, payload);

      expect(mockClient.models.generateContent).toHaveBeenCalledWith({
        config: expect.objectContaining({
          safetySettings: expect.any(Array),
          toolConfig: {
            functionCallingConfig: {
              mode: 'ANY',
            },
          },
          tools: [
            {
              functionDeclarations: [
                {
                  description: 'Get weather information',
                  name: 'get_weather',
                  parameters: {
                    description: undefined,
                    properties: {
                      city: { type: 'string' },
                      unit: { type: 'string' },
                    },
                    required: ['city'],
                    type: SchemaType.OBJECT,
                  },
                },
              ],
            },
          ],
        }),
        contents,
        model: 'gemini-2.5-flash',
      });

      expect(result).toEqual([
        { arguments: { city: 'New York', unit: 'celsius' }, name: 'get_weather' },
      ]);
    });

    it('should handle multiple function calls', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        args: { city: 'New York', unit: 'celsius' },
                        name: 'get_weather',
                      },
                    },
                    {
                      functionCall: {
                        args: { timezone: 'America/New_York' },
                        name: 'get_time',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
      };

      const contents: any[] = [];

      const payload = {
        contents,
        model: 'gemini-2.5-flash',
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

      const result = await createGoogleGenerateObjectWithTools(mockClient as any, payload);

      expect(result).toEqual([
        { arguments: { city: 'New York', unit: 'celsius' }, name: 'get_weather' },
        { arguments: { timezone: 'America/New_York' }, name: 'get_time' },
      ]);
    });

    it('should handle options correctly', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        args: { a: 5, b: 3, operation: 'add' },
                        name: 'calculate',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
      };

      const contents: any[] = [];

      const payload = {
        contents,
        model: 'gemini-2.5-flash',
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

      const options = {
        signal: new AbortController().signal,
      };

      const result = await createGoogleGenerateObjectWithTools(mockClient as any, payload, options);

      expect(mockClient.models.generateContent).toHaveBeenCalledWith({
        config: expect.objectContaining({
          abortSignal: options.signal,
        }),
        contents,
        model: 'gemini-2.5-flash',
      });

      expect(result).toEqual([{ arguments: { a: 5, b: 3, operation: 'add' }, name: 'calculate' }]);
    });

    it('should return undefined when no function calls in response', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: 'Some text response without function call',
                    },
                  ],
                },
              },
            ],
          }),
        },
      };

      const contents: any[] = [];

      const payload = {
        contents,
        model: 'gemini-2.5-flash',
        tools: [
          {
            function: {
              description: 'Test function',
              name: 'test_function',
              parameters: {
                properties: {},
                type: 'object' as const,
              },
            },
            type: 'function' as const,
          },
        ],
      };

      const result = await createGoogleGenerateObjectWithTools(mockClient as any, payload);

      expect(result).toBeUndefined();
    });

    it('should return undefined when no content parts in response', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            candidates: [
              {
                content: {},
              },
            ],
          }),
        },
      };

      const contents: any[] = [];

      const payload = {
        contents,
        model: 'gemini-2.5-flash',
        tools: [
          {
            function: {
              description: 'Test function',
              name: 'test_function',
              parameters: {
                properties: {},
                type: 'object' as const,
              },
            },
            type: 'function' as const,
          },
        ],
      };

      const result = await createGoogleGenerateObjectWithTools(mockClient as any, payload);

      expect(result).toBeUndefined();
    });

    it('should propagate API errors correctly', async () => {
      const apiError = new Error('API Error: Model not found');

      const mockClient = {
        models: {
          generateContent: vi.fn().mockRejectedValue(apiError),
        },
      };

      const contents: any[] = [];

      const payload = {
        contents,
        model: 'gemini-2.5-flash',
        tools: [
          {
            function: {
              description: 'Test function',
              name: 'test_function',
              parameters: {
                properties: {},
                type: 'object' as const,
              },
            },
            type: 'function' as const,
          },
        ],
      };

      await expect(createGoogleGenerateObjectWithTools(mockClient as any, payload)).rejects.toThrow(
        'API Error: Model not found',
      );
    });

    it('should handle abort signals correctly', async () => {
      const apiError = new Error('Request was cancelled');
      apiError.name = 'AbortError';

      const mockClient = {
        models: {
          generateContent: vi.fn().mockRejectedValue(apiError),
        },
      };

      const contents: any[] = [];

      const payload = {
        contents,
        model: 'gemini-2.5-flash',
        tools: [
          {
            function: {
              description: 'Test function',
              name: 'test_function',
              parameters: {
                properties: {},
                type: 'object' as const,
              },
            },
            type: 'function' as const,
          },
        ],
      };

      const options = {
        signal: new AbortController().signal,
      };

      await expect(
        createGoogleGenerateObjectWithTools(mockClient as any, payload, options),
      ).rejects.toThrow();
    });

    it('should handle tools with empty parameters', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        args: {},
                        name: 'simple_function',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
      };

      const contents: any[] = [];

      const payload = {
        contents,
        model: 'gemini-2.5-flash',
        tools: [
          {
            function: {
              description: 'A simple function with no parameters',
              name: 'simple_function',
              parameters: {
                properties: {},
                type: 'object' as const,
              },
            },
            type: 'function' as const,
          },
        ],
      };

      const result = await createGoogleGenerateObjectWithTools(mockClient as any, payload);

      // Should use dummy property for empty parameters
      expect(mockClient.models.generateContent).toHaveBeenCalledWith({
        config: expect.objectContaining({
          tools: [
            {
              functionDeclarations: [
                expect.objectContaining({
                  parameters: expect.objectContaining({
                    properties: { dummy: { type: 'string' } },
                  }),
                }),
              ],
            },
          ],
        }),
        contents,
        model: 'gemini-2.5-flash',
      });

      expect(result).toEqual([{ arguments: {}, name: 'simple_function' }]);
    });
  });
});
