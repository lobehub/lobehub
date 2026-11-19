import { z } from 'zod';

import { jsonObjectSchema } from './common.type';

export const ToolCallRequestSchema = z
  .object({
    agentId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Resolve `identifier` the way this agent's runs do (its own connector first). Omit for the workspace / personal connector.",
      ),
    arguments: jsonObjectSchema
      .optional()
      .describe("Tool arguments, matching the tool's `inputSchema`."),
    identifier: z.string().trim().min(1).max(255).describe('The connector `identifier`.'),
    linkId: z
      .string()
      .min(1)
      .optional()
      .describe('The account to call as, for a connector connected to several accounts.'),
    toolName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .describe('The tool `name`, as listed on the connector.'),
  })
  .strict();

export const McpServerToolCallRequestSchema = ToolCallRequestSchema.pick({
  arguments: true,
  toolName: true,
}).strict();

export const ToolCallErrorSchema = z
  .object({ message: z.string(), type: z.string() })
  .strict()
  .meta({ id: 'ToolCallError' });

export const ToolCallResultSchema = z
  .object({
    content: z
      .string()
      .describe(
        'The tool result as text (as a model would read it). Media the tool returns is stored as files and linked.',
      ),
    error: ToolCallErrorSchema.nullable().describe('Set when the tool ran and reported a failure.'),
    success: z.boolean(),
  })
  .strict()
  .meta({ id: 'ToolCallResult' });

export type McpServerToolCallRequest = z.infer<typeof McpServerToolCallRequestSchema>;
export type ToolCallRequest = z.infer<typeof ToolCallRequestSchema>;
export type ToolCallResult = z.infer<typeof ToolCallResultSchema>;
