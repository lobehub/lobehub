import { z } from 'zod';

import { pageInfoShape, totalShape } from '../helpers/pagination';
import { dateTimeSchema, jsonObjectSchema } from './common.type';

// ==================== Response Schemas ====================

/**
 * An installed plugin as `GET /plugins` exposes it: the inventory only.
 * Credentials, settings, custom connection parameters and manifests are not
 * public capability metadata and are never selected.
 */
export const InstalledPluginSchema = z
  .object({
    createdAt: dateTimeSchema,
    identifier: z.string(),
    type: z.enum(['plugin', 'customPlugin']),
    updatedAt: dateTimeSchema,
  })
  .strict()
  .meta({ id: 'InstalledPlugin' });

export const InstalledPluginListSchema = z
  .object({
    ...pageInfoShape,
    plugins: z.array(InstalledPluginSchema),
    ...totalShape,
  })
  .strict()
  .meta({ id: 'InstalledPluginList' });

// ==================== Request Schemas ====================

export const PluginIdentifierParamSchema = z.object({
  identifier: z.string().min(1).max(255),
});

export const InstallPluginRequestSchema = z
  .object({
    customParams: jsonObjectSchema
      .optional()
      .describe('Connection parameters of a custom plugin (e.g. its MCP endpoint).'),
    identifier: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .describe('Plugin identifier; must match `manifest.identifier`.'),
    manifest: jsonObjectSchema.describe('The plugin manifest (LobeHub plugin manifest format).'),
    settings: jsonObjectSchema.optional().describe('Initial plugin settings.'),
    type: z
      .enum(['plugin', 'customPlugin'])
      .describe('`plugin` for a marketplace plugin, `customPlugin` for a self-hosted one.'),
  })
  .strict()
  .refine((value) => value.manifest.identifier === value.identifier, {
    message: 'manifest.identifier must equal identifier',
    path: ['manifest', 'identifier'],
  });

export const UpdatePluginRequestSchema = z
  .object({
    customParams: jsonObjectSchema.optional(),
    manifest: jsonObjectSchema.optional(),
    settings: jsonObjectSchema.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one field must be provided',
  });

export type InstallPluginRequest = z.infer<typeof InstallPluginRequestSchema>;
export type InstalledPlugin = z.infer<typeof InstalledPluginSchema>;
export type UpdatePluginRequest = z.infer<typeof UpdatePluginRequestSchema>;
