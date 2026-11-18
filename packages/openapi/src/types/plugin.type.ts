import { z } from 'zod';

import { dateTimeSchema } from './common.type';

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
  .object({ plugins: z.array(InstalledPluginSchema), total: z.number().int().min(0) })
  .strict()
  .meta({ id: 'InstalledPluginList' });
