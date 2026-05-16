// @vitest-environment node
import { Type as SchemaType } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';

import { buildGoogleTool, sanitizeGeminiSchema } from '../../core/contextBuilders/google';
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

    // LOBE-8661: enum should only be copied for STRING type properties
    it('should strip enum from non-STRING types', () => {
      const openAISchema = {
        name: 'test',
        schema: {
          properties: {
            priority: { enum: ['low', 'medium', 'high'], type: 'number' },
            status: { enum: ['active', 'inactive'], type: 'string' },
            visible: { enum: ['true'], type: 'boolean' },
          },
          type: 'object' as const,
        },
      };

      const result = convertOpenAISchemaToGoogleSchema(openAISchema);

      // enum should be stripped from number and boolean types
      expect(result).toEqual({
        properties: {
          priority: { type: SchemaType.NUMBER },
          status: { enum: ['active', 'inactive'], type: SchemaType.STRING },
          visible: { type: SchemaType.BOOLEAN },
        },
        type: SchemaType.OBJECT,
      });
    });

    // LOBE-8661: enum with empty array should be stripped even for STRING type
    it('should strip empty enum arrays', () => {
      const openAISchema = {
        name: 'test',
        schema: {
          properties: {
            status: { enum: [], type: 'string' },
          },
          type: 'object' as const,
        },
      };

      const result = convertOpenAISchemaToGoogleSchema(openAISchema);

      expect(result).toEqual({
        properties: {
          status: { type: SchemaType.STRING },
        },
        type: SchemaType.OBJECT,
      });
    });

    // LOBE-8661: required should only be copied for OBJECT types
    it('should strip required from non-OBJECT types', () => {
      const openAISchema = {
        name: 'test',
        schema: {
          properties: {
            nested: {
              properties: { name: { type: 'string' } },
              required: ['name'],
              type: 'object',
            },
          },
          required: ['nested'],
          type: 'object' as const,
        },
      } as any;

      const result = convertOpenAISchemaToGoogleSchema(openAISchema);

      // required should be preserved for OBJECT types (both root and nested)
      expect(result).toEqual({
        properties: {
          nested: {
            properties: {
              name: { type: SchemaType.STRING },
            },
            required: ['name'],
            type: SchemaType.OBJECT,
          },
        },
        required: ['nested'],
        type: SchemaType.OBJECT,
      });
    });
  });

  describe('sanitizeGeminiSchema', () => {
    it('should strip enum from non-STRING types', () => {
      const schema = {
        properties: {
          priority: { enum: [1, 2, 3], type: 'integer' },
          status: { enum: ['active'], type: 'string' },
        },
        type: 'object',
      };

      const result = sanitizeGeminiSchema(schema);

      expect(result).toEqual({
        properties: {
          priority: { type: 'integer' },
          status: { enum: ['active'], type: 'string' },
        },
        type: 'object',
      });
    });

    it('should strip required from non-OBJECT types', () => {
      const schema = {
        properties: {
          name: { required: ['firstName'], type: 'string' },
          user: {
            properties: { name: { type: 'string' } },
            required: ['name'],
            type: 'object',
          },
        },
        type: 'object',
      };

      const result = sanitizeGeminiSchema(schema);

      expect(result).toEqual({
        properties: {
          name: { type: 'string' },
          user: {
            properties: { name: { type: 'string' } },
            required: ['name'],
            type: 'object',
          },
        },
        type: 'object',
      });
    });

    it('should recursively sanitize nested properties', () => {
      const schema = {
        properties: {
          dashboard: {
            properties: {
              widgets: {
                items: {
                  properties: {
                    color: { enum: ['red'], type: 'string' },
                    priority: { enum: [1, 2], type: 'number' },
                    visible: { enum: ['true'], type: 'boolean' },
                  },
                  type: 'object',
                },
                type: 'array',
              },
            },
            type: 'object',
          },
        },
        type: 'object',
      };

      const result = sanitizeGeminiSchema(schema);

      expect(result).toEqual({
        properties: {
          dashboard: {
            properties: {
              widgets: {
                items: {
                  properties: {
                    color: { enum: ['red'], type: 'string' },
                    priority: { type: 'number' },
                    visible: { type: 'boolean' },
                  },
                  type: 'object',
                },
                type: 'array',
              },
            },
            type: 'object',
          },
        },
        type: 'object',
      });
    });

    it('should handle empty enum arrays', () => {
      const schema = {
        properties: {
          status: { enum: [], type: 'string' },
        },
        type: 'object',
      };

      const result = sanitizeGeminiSchema(schema);

      expect(result).toEqual({
        properties: {
          status: { type: 'string' },
        },
        type: 'object',
      });
    });

    it('should handle anyOf/oneOf/allOf combinators', () => {
      const schema = {
        anyOf: [
          { enum: [1, 2], type: 'number' },
          { enum: ['low'], type: 'string' },
        ],
      };

      const result = sanitizeGeminiSchema(schema);

      expect(result).toEqual({
        anyOf: [{ type: 'number' }, { enum: ['low'], type: 'string' }],
      });
    });

    it('should handle null/undefined gracefully', () => {
      expect(sanitizeGeminiSchema(null)).toBeNull();
      expect(sanitizeGeminiSchema(undefined)).toBeUndefined();
    });

    // LOBE-8661: nullable string enums should be preserved
    it('should preserve enum on nullable STRING types (type: array with string)', () => {
      const schema = {
        properties: {
          status: {
            enum: ['active', 'inactive', null],
            type: ['string', 'null'],
          },
        },
        type: 'object',
      };

      const result = sanitizeGeminiSchema(schema);

      expect(result).toEqual({
        properties: {
          status: {
            enum: ['active', 'inactive', null],
            type: ['string', 'null'],
          },
        },
        type: 'object',
      });
    });

    // LOBE-8661: nullable object required should be preserved
    it('should preserve required on nullable OBJECT types (type: array with object)', () => {
      const schema = {
        properties: {
          config: {
            properties: { key: { type: 'string' } },
            required: ['key'],
            type: ['object', 'null'],
          },
        },
        type: 'object',
      };

      const result = sanitizeGeminiSchema(schema);

      expect(result).toEqual({
        properties: {
          config: {
            properties: { key: { type: 'string' } },
            required: ['key'],
            type: ['object', 'null'],
          },
        },
        type: 'object',
      });
    });

    // LOBE-8661: should strip enum from nullable non-STRING types
    it('should strip enum from nullable non-STRING types (type: array without string)', () => {
      const schema = {
        properties: {
          count: {
            enum: [1, 2, 3],
            type: ['integer', 'null'],
          },
        },
        type: 'object',
      };

      const result = sanitizeGeminiSchema(schema);

      expect(result).toEqual({
        properties: {
          count: {
            type: ['integer', 'null'],
          },
        },
        type: 'object',
      });
    });

    // LOBE-8661: recurse into definitions/$defs
    it('should sanitize schemas under definitions', () => {
      const schema = {
        definitions: {
          Priority: { enum: [1, 2, 3], type: 'number' },
          Status: { enum: ['active', 'inactive'], type: 'string' },
        },
        properties: {
          priority: { $ref: '#/definitions/Priority' },
          status: { $ref: '#/definitions/Status' },
        },
        type: 'object',
      };

      const result = sanitizeGeminiSchema(schema);

      expect(result).toEqual({
        definitions: {
          Priority: { type: 'number' },
          Status: { enum: ['active', 'inactive'], type: 'string' },
        },
        properties: {
          priority: { $ref: '#/definitions/Priority' },
          status: { $ref: '#/definitions/Status' },
        },
        type: 'object',
      });
    });

    // LOBE-8661: recurse into $defs
    it('should sanitize schemas under $defs', () => {
      const schema = {
        $defs: {
          Shape: { enum: ['circle', 'square'], required: ['radius'], type: 'string' },
        },
        properties: {
          shape: { $ref: '#/$defs/Shape' },
        },
        type: 'object',
      };

      const result = sanitizeGeminiSchema(schema);

      expect(result).toEqual({
        $defs: {
          Shape: { enum: ['circle', 'square'], type: 'string' },
        },
        properties: {
          shape: { $ref: '#/$defs/Shape' },
        },
        type: 'object',
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

    it('should call onUsage callback with usage data', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: '{"result": "ok"}',
            usageMetadata: {
              candidatesTokenCount: 20,
              promptTokenCount: 80,
              totalTokenCount: 100,
            },
          }),
        },
      };

      const contents = [{ parts: [{ text: 'Generate data' }], role: 'user' }];

      const payload = {
        contents,
        model: 'gemini-2.5-flash',
        schema: {
          name: 'test',
          schema: {
            properties: { result: { type: 'string' } },
            type: 'object' as const,
          },
        },
      };

      const onUsage = vi.fn();
      const result = await createGoogleGenerateObject(mockClient as any, payload, { onUsage });

      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          totalInputTokens: 80,
          totalOutputTokens: 20,
        }),
      );
      expect(result).toEqual({ result: 'ok' });
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
                  parametersJsonSchema: {
                    properties: {
                      city: { type: 'string' },
                      unit: { type: 'string' },
                    },
                    required: ['city'],
                    type: 'object',
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

    it('should call onUsage callback with usage data', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        args: { city: 'Tokyo' },
                        name: 'get_weather',
                      },
                    },
                  ],
                },
              },
            ],
            usageMetadata: {
              candidatesTokenCount: 30,
              promptTokenCount: 70,
              totalTokenCount: 100,
            },
          }),
        },
      };

      const contents = [{ parts: [{ text: 'What is the weather in Tokyo?' }], role: 'user' }];

      const payload = {
        contents,
        model: 'gemini-2.5-flash',
        tools: [
          {
            function: {
              description: 'Get weather information',
              name: 'get_weather',
              parameters: {
                properties: { city: { type: 'string' } },
                required: ['city'],
                type: 'object' as const,
              },
            },
            type: 'function' as const,
          },
        ],
      };

      const onUsage = vi.fn();
      const result = await createGoogleGenerateObjectWithTools(mockClient as any, payload, {
        onUsage,
      });

      expect(onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          totalInputTokens: 70,
          totalOutputTokens: 30,
        }),
      );
      expect(result).toEqual([{ arguments: { city: 'Tokyo' }, name: 'get_weather' }]);
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
                  parametersJsonSchema: expect.objectContaining({
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

    // LOBE-8661: buildGoogleTool should sanitize schema to strip enum from non-STRING types
    it('should sanitize enum from non-STRING types in tool parameters', () => {
      const tool: any = {
        function: {
          description: 'Update status',
          name: 'update_status',
          parameters: {
            properties: {
              priority: { enum: [1, 2, 3], type: 'integer' },
              status: { enum: ['active', 'inactive'], type: 'string' },
            },
            required: ['status'],
            type: 'object',
          },
        },
        type: 'function',
      };

      // Suppress console.warn from sanitizer
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = buildGoogleTool(tool);

      expect(result.parametersJsonSchema).toEqual({
        properties: {
          priority: { type: 'integer' },
          status: { enum: ['active', 'inactive'], type: 'string' },
        },
        required: ['status'],
        type: 'object',
      });

      warnSpy.mockRestore();
    });

    // LOBE-8661: buildGoogleTool should sanitize nested tool parameters
    it('should sanitize nested enum/required in tool parameters', () => {
      const tool: any = {
        function: {
          description: 'Complex operation',
          name: 'complex_op',
          parameters: {
            properties: {
              config: {
                properties: {
                  color: { enum: ['red'], type: 'string' },
                  level: { enum: [1, 2, 3], type: 'number' },
                },
                required: ['color'],
                type: 'object',
              },
              role: { required: ['admin'], type: 'string' },
            },
            type: 'object',
          },
        },
        type: 'function',
      };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = buildGoogleTool(tool);

      expect(result.parametersJsonSchema).toEqual({
        properties: {
          config: {
            properties: {
              color: { enum: ['red'], type: 'string' },
              level: { type: 'number' },
            },
            required: ['color'],
            type: 'object',
          },
          role: { type: 'string' },
        },
        type: 'object',
      });

      warnSpy.mockRestore();
    });

    // LOBE-8661: buildGoogleTool should preserve nullable string enum
    it('should preserve enum on nullable STRING type in tool parameters', () => {
      const tool: any = {
        function: {
          description: 'A tool with nullable enum',
          name: 'nullableTool',
          parameters: {
            properties: {
              status: {
                enum: ['active', 'inactive', null],
                type: ['string', 'null'],
              },
            },
            type: 'object',
          },
        },
        type: 'function',
      };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = buildGoogleTool(tool);

      // nullable types and null enum values should be passed through as-is
      expect(result.parametersJsonSchema).toEqual({
        properties: {
          status: {
            enum: ['active', 'inactive', null],
            type: ['string', 'null'],
          },
        },
        type: 'object',
      });

      warnSpy.mockRestore();
    });
  });
});
