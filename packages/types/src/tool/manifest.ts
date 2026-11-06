import { z } from 'zod';

import { type LobeChatPluginApi, LobeChatPluginApiSchema, type Meta, MetaSchema } from './builtin';

export type ToolManifestType = 'builtin' | 'default' | 'markdown' | 'mcp' | 'standalone';

export interface ToolManifestSettings {
  properties: Record<string, any>;
  required?: string[];
  type: 'object';
}

export const ToolManifestSettingsSchema = z.object({
  properties: z.record(z.string(), z.any()),
  required: z.array(z.string()).optional(),
  type: z.literal('object'),
});

export interface ToolManifest {
  $schema?: string;
  api: LobeChatPluginApi[];
  author?: string;
  createdAt?: string;
  gateway?: string;
  homepage?: string;
  identifier: string;
  /**
   * MCP Apps: tools the server keeps from the model (`_meta.ui.visibility`
   * without "model"). Only its views may call them; never part of `api`.
   */
  mcpAppOnlyApi?: LobeChatPluginApi[];
  /** MCP Apps: tools in `api` the server's views may not call (no "app"). */
  mcpModelOnlyTools?: string[];
  meta: Meta;
  openapi?: string;
  settings?: ToolManifestSettings;
  systemRole?: string;
  type?: ToolManifestType;
  ui?: { height?: number; mode?: 'iframe' | 'module'; url: string; width?: number };
  version?: string;
}

export const ToolManifestSchema = z.object({
  $schema: z.string().optional(),
  api: z.array(LobeChatPluginApiSchema),
  author: z.string().optional(),
  createdAt: z.string().optional(),
  gateway: z.string().optional(),
  homepage: z.string().optional(),
  identifier: z.string(),
  mcpAppOnlyApi: z.array(LobeChatPluginApiSchema).optional(),
  mcpModelOnlyTools: z.array(z.string()).optional(),
  meta: MetaSchema,
  openapi: z.string().optional(),
  settings: ToolManifestSettingsSchema.optional(),
  systemRole: z.string().optional(),
  type: z.enum(['default', 'standalone', 'markdown', 'builtin', 'mcp']).optional(),
  ui: z
    .object({
      height: z.number().optional(),
      mode: z.enum(['iframe', 'module']).optional(),
      url: z.string(),
      width: z.number().optional(),
    })
    .optional(),
  version: z.string().optional(),
});
