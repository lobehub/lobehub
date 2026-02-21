import type { GenerateContentConfig, GoogleGenAI } from '@google/genai';
import { FunctionCallingConfigMode, Type as SchemaType } from '@google/genai';
import Debug from 'debug';

import { buildGoogleTool } from '../../core/contextBuilders/google';
import type { ChatCompletionTool, GenerateObjectOptions, GenerateObjectSchema } from '../../types';

const debug = Debug('lobe-mode-runtime:google:generateObject');

enum HarmCategory {
  HARM_CATEGORY_DANGEROUS_CONTENT = 'HARM_CATEGORY_DANGEROUS_CONTENT',
  HARM_CATEGORY_HARASSMENT = 'HARM_CATEGORY_HARASSMENT',
  HARM_CATEGORY_HATE_SPEECH = 'HARM_CATEGORY_HATE_SPEECH',
  HARM_CATEGORY_SEXUALLY_EXPLICIT = 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
}

enum HarmBlockThreshold {
  BLOCK_NONE = 'BLOCK_NONE',
}

const modelsOffSafetySettings = new Set(['gemini-2.0-flash-exp']);

function getThreshold(model: string): HarmBlockThreshold {
  if (modelsOffSafetySettings.has(model)) {
    return 'OFF' as HarmBlockThreshold; // https://discuss.ai.google.dev/t/59352
  }
  return HarmBlockThreshold.BLOCK_NONE;
}

const convertType = (type: string): SchemaType => {
  switch (type) {
    case 'string': {
      return SchemaType.STRING;
    }
    case 'number': {
      return SchemaType.NUMBER;
    }
    case 'integer': {
      return SchemaType.INTEGER;
    }
    case 'boolean': {
      return SchemaType.BOOLEAN;
    }
    case 'array': {
      return SchemaType.ARRAY;
    }
    case 'object': {
      return SchemaType.OBJECT;
    }
    default: {
      return SchemaType.STRING;
    }
  }
};

/**
 * Convert OpenAI JSON schema to Google Gemini schema format
 */
export const convertOpenAISchemaToGoogleSchema = (openAISchema: GenerateObjectSchema): any => {
  const convertSchema = (schema: any): any => {
    if (!schema) return schema;

    const converted: any = {
      type: convertType(schema.type),
    };

    if (schema.description) {
      converted.description = schema.description;
    }

    if (schema.enum) {
      converted.enum = schema.enum;
    }

    if (schema.properties) {
      converted.properties = {};
      for (const [key, value] of Object.entries(schema.properties)) {
        converted.properties[key] = convertSchema(value);
      }
    }

    if (schema.items) {
      converted.items = convertSchema(schema.items);
    }

    if (schema.required) {
      converted.required = schema.required;
    }

    if (schema.propertyOrdering) {
      converted.propertyOrdering = schema.propertyOrdering;
    }

    return converted;
  };

  return convertSchema(openAISchema.schema);
};

/**
 * Generate structured output using Google Gemini API
 * @see https://ai.google.dev/gemini-api/docs/structured-output
 */
export const createGoogleGenerateObject = async (
  client: GoogleGenAI,
  payload: {
    contents: any[];
    model: string;
    schema: GenerateObjectSchema;
  },
  options?: GenerateObjectOptions,
) => {
  const { schema, contents, model } = payload;

  debug('createGoogleGenerateObject started', {
    contentsLength: contents.length,
    hasSchema: !!schema,
    model,
  });

  // Convert OpenAI schema to Google schema format
  const responseSchema = convertOpenAISchemaToGoogleSchema(schema);
  debug('Schema conversion completed', {
    convertedSchema: responseSchema,
    originalSchema: schema,
  });

  const config: GenerateContentConfig = {
    abortSignal: options?.signal,
    responseMimeType: 'application/json',
    responseSchema,
    // avoid wide sensitive words
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: getThreshold(model),
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: getThreshold(model),
      },
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: getThreshold(model),
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: getThreshold(model),
      },
    ],
  };

  debug('Config prepared', {
    hasAbortSignal: !!config.abortSignal,
    hasSafetySettings: !!config.safetySettings,
    model,
    responseMimeType: config.responseMimeType,
  });

  const response = await client.models.generateContent({
    config,
    contents,
    model,
  });

  debug('API response received', { hasText: !!response.text, textLength: response.text?.length });

  const text = response.text;

  try {
    const result = JSON.parse(text!);
    debug('JSON parsing successful', result);
    return result;
  } catch {
    console.error('parse json error:', text);

    return undefined;
  }
};

/**
 * Generate structured output using Google Gemini API with tools calling
 * @see https://ai.google.dev/gemini-api/docs/function-calling
 */
export const createGoogleGenerateObjectWithTools = async (
  client: GoogleGenAI,
  payload: {
    contents: any[];
    model: string;
    tools: ChatCompletionTool[];
  },
  options?: GenerateObjectOptions,
) => {
  const { tools, contents, model } = payload;

  debug('createGoogleGenerateObjectWithTools started', {
    contentsLength: contents.length,
    model,
    toolsCount: tools.length,
  });

  // Convert tools to Google FunctionDeclaration format
  const functionDeclarations = tools.map(buildGoogleTool);
  debug('Tools conversion completed', { functionDeclarations });

  const config: GenerateContentConfig = {
    abortSignal: options?.signal,
    // avoid wide sensitive words
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: getThreshold(model),
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: getThreshold(model),
      },
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: getThreshold(model),
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: getThreshold(model),
      },
    ],
    // Force tool calling with 'any' mode
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingConfigMode.ANY,
      },
    },
    tools: [{ functionDeclarations }],
  };

  debug('Config prepared', {
    hasAbortSignal: !!config.abortSignal,
    hasSafetySettings: !!config.safetySettings,
    hasTools: !!config.tools,
    model,
  });

  const response = await client.models.generateContent({
    config,
    contents,
    model,
  });

  debug('API response received', {
    candidatesCount: response.candidates?.length,
    hasContent: !!response.candidates?.[0]?.content,
  });

  // Extract function calls from response
  const candidate = response.candidates?.[0];
  if (!candidate?.content?.parts) {
    debug('no content parts in response');
    return undefined;
  }

  const functionCalls = candidate.content.parts
    .filter((part) => part.functionCall)
    .map((part) => ({
      arguments: part.functionCall!.args,
      name: part.functionCall!.name,
    }));

  debug('extracted function calls', { count: functionCalls.length, functionCalls });

  return functionCalls.length > 0 ? functionCalls : undefined;
};
