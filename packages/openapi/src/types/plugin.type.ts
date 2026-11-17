import { z } from 'zod';

import { pageInfoShape, totalShape } from '../helpers/pagination';
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
  .object({
    ...pageInfoShape,
    plugins: z.array(InstalledPluginSchema),
    ...totalShape,
  })
  .strict()
  .meta({ id: 'InstalledPluginList' });
