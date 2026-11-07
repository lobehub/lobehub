import { z } from 'zod';

export const McpCallIdentitySchema = z.object({
  apiName: z.string().min(1),
  assistantMessageId: z.string().min(1),
  identifier: z.string().min(1),
  operationId: z.string().min(1),
  toolCallId: z.string().min(1),
  toolMessageId: z.string().optional(),
});
export const McpElicitationCallSchema = z.object({
  identity: McpCallIdentitySchema,
  deadline: z.number().finite(),
  workspaceId: z.string().optional(),
});
export const McpElicitationResponseSchema = z
  .object({
    action: z.enum(['accept', 'decline', 'cancel']),
    content: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
      .optional(),
  })
  .strict();
