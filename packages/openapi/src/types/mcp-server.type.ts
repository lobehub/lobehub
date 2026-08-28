import { z } from 'zod';

const HttpMcpServerUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'MCP server URL must use http or https',
  })
  .refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password;
  }, 'MCP server URL must not contain embedded credentials');

export const McpServerCredentialsSchema = z.discriminatedUnion('type', [
  z.object({ token: z.string().min(1).max(10_000), type: z.literal('bearer') }).strict(),
  z.object({ apiKey: z.string().min(1).max(10_000), type: z.literal('apikey') }).strict(),
  z
    .object({
      headers: z
        .record(z.string().min(1).max(256), z.string().max(10_000))
        .refine((headers) => Object.keys(headers).length <= 20, 'At most 20 headers are allowed'),
      type: z.literal('header'),
    })
    .strict(),
]);

export const CreateMcpServerRequestSchema = z
  .object({
    credentials: McpServerCredentialsSchema.optional(),
    description: z.string().trim().max(2000).optional(),
    identifier: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[a-z\d](?:[\w-]*[a-z\d])?$/i, 'Invalid MCP server identifier'),
    isEnabled: z.boolean().default(true).optional(),
    name: z.string().trim().min(1).max(255),
    serverUrl: HttpMcpServerUrlSchema,
  })
  .strict();

export const UpdateMcpServerRequestSchema = z
  .object({
    credentials: McpServerCredentialsSchema.nullish(),
    description: z.string().trim().max(2000).nullable().optional(),
    isEnabled: z.boolean().optional(),
    name: z.string().trim().min(1).max(255).optional(),
    serverUrl: HttpMcpServerUrlSchema.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one field must be provided',
  });

export const McpServerIdParamSchema = z.object({ id: z.uuid() });

export type CreateMcpServerRequest = z.infer<typeof CreateMcpServerRequestSchema>;
export type UpdateMcpServerRequest = z.infer<typeof UpdateMcpServerRequestSchema>;

export interface McpServerToolResponse {
  description: null | string;
  id: string;
  inputSchema: null | Record<string, unknown>;
  name: string;
  permission: string;
}

export interface McpServerResponse {
  createdAt: Date;
  description: null | string;
  hasCredentials: boolean;
  id: string;
  identifier: string;
  isEnabled: boolean;
  name: string;
  serverUrl: string;
  status: string;
  tools: McpServerToolResponse[];
  updatedAt: Date;
}
