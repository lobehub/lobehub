import type { GenerateObjectSchema } from '@lobechat/model-runtime';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export interface BuildSchemaOptions {
  description?: string;
  name: string;
  strict?: boolean;
}

const pickMainSchema = (result: any, name: string) => {
  if (result?.$defs?.[name]) {
    return result.$defs[name];
  }
  if (result?.definitions?.[name]) {
    return result.definitions[name];
  }

  return result;
};

export const buildGenerateObjectSchema = (
  schema: z.ZodTypeAny,
  options: BuildSchemaOptions,
): GenerateObjectSchema => {
  const fullSchema = zodToJsonSchema(schema, options.name);

  const jsonSchema = pickMainSchema(fullSchema, options.name);
  if (jsonSchema.type === 'object') {
    jsonSchema.additionalProperties = false;
  }

  return {
    description: options.description,
    name: options.name,
    schema: jsonSchema,
    strict: options.strict ?? true,
  } satisfies GenerateObjectSchema;
};
