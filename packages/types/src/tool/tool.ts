import { z } from 'zod';

import type { MetaData } from '../meta';

export type LobeToolType = 'builtin' | 'customPlugin' | 'plugin';

export interface LobeToolMeta extends MetaData {
  author?: string;
  identifier: string;
  /**
   * @deprecated
   */
  meta: MetaData;
  type: LobeToolType;
}

export interface LobeUniformTool {
  /**
   * The description of what the function does.
   */
  description?: string;
  /**
   * The name of the function to be called. Must be a-z, A-Z, 0-9, or contain underscores and dashes, with a maximum length of 64.
   */
  name: string;
  /**
   * The parameters the functions accepts, described as a JSON Schema object. See the [guide](/docs/guides/gpt/function-calling) for examples, and the [JSON Schema reference](https://json-schema.org/understanding-json-schema/) for documentation about the format.
   */
  parameters: {
    additionalProperties?: boolean;
    properties: Record<string, any>;
    required?: string[];
    type: 'object';
  };
}

export const LobeUniformToolSchema = z.object({
  description: z.string().optional(),
  name: z.string(),
  parameters: z.object({
    additionalProperties: z.boolean().optional(),
    properties: z.record(z.string(), z.any()),
    required: z.array(z.string()).optional(),
    type: z.literal('object'),
  }),
});
