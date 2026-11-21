import { z } from 'zod';

import { LobeChatPluginApiSchema, MetaSchema } from '../tool/builtin';

/** Model-facing contract only. Addresses, credentials and execution routing live in bindings. */
export const evalToolManifestSchema = z
  .object({
    api: z
      .array(
        LobeChatPluginApiSchema.pick({ name: true, description: true, parameters: true })
          .strict()
          .refine(
            (api) => !api.name.includes('____'),
            'Tool names cannot contain the routing separator',
          ),
      )
      .min(1),
    identifier: z
      .string()
      .min(1)
      .max(255)
      .refine(
        (id) => !id.includes('____'),
        'Tool identifiers cannot contain the routing separator',
      ),
    meta: MetaSchema,
    systemRole: z.string().optional(),
    type: z.enum(['builtin', 'default', 'markdown', 'mcp', 'standalone']).optional(),
  })
  .strict()
  .refine(
    (manifest) => new Set(manifest.api.map((api) => api.name)).size === manifest.api.length,
    'Tool names must be unique within a contract',
  );

export const evalToolManifestsSchema = z
  .record(z.string().min(1).max(255), evalToolManifestSchema)
  .refine(
    (manifests) =>
      Object.entries(manifests).every(([key, manifest]) => key === manifest.identifier),
    'Tool contract keys must match their identifiers',
  );

export type EvalToolManifest = z.infer<typeof evalToolManifestSchema>;
export type EvalToolManifests = Record<string, EvalToolManifest>;
