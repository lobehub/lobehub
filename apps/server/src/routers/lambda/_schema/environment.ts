import { z } from 'zod';

import { relativePathSchema } from '../sandboxStorage/schemas';

/**
 * The hosts a checkout may name.
 *
 * An allowlist rather than an SSRF check on the resolved address, because the
 * clone does not happen here: the stored specification is handed to the
 * execution plane, which resolves and fetches it from its own network, so no
 * validation at this layer can speak for what that resolution will return.
 * Naming the hosts is the part this layer can be sure of — and every producer
 * already names exactly one, since a source is chosen through the GitHub
 * repository picker and the UI parses the URL back assuming that host.
 */
const ALLOWED_SOURCE_HOSTS = new Set(['github.com', 'www.github.com']);

/**
 * Where source material comes from. Only `git` for now, and only over HTTPS:
 * the other transports authenticate with a key, and a specification that
 * carries no credentials cannot present one. Private repositories are a
 * separate problem, not a URL scheme.
 *
 * The host is checked because this schema guards an RPC, not the picker: a
 * caller reaching it directly could otherwise store any URL, and a build would
 * then make the execution plane fetch it — an internal address included.
 */
const environmentSourceSchema = z.object({
  kind: z.literal('git'),
  /** Where the checkout lands, relative to the instance's own directory. */
  path: relativePathSchema.optional(),
  ref: z.string().trim().min(1).max(255).optional(),
  url: z
    .string()
    .url()
    .refine(
      (value) => {
        let parsed;
        try {
          parsed = new URL(value);
        } catch {
          return false;
        }

        return parsed.protocol === 'https:' && ALLOWED_SOURCE_HOSTS.has(parsed.hostname);
      },
      { message: 'Only https:// github.com git URLs are supported' },
    ),
});

/**
 * Non-secret values only. Enforced by shape as far as a shape can: the name has
 * to look like an environment variable, and the rest is said plainly in the UI
 * and in the type. A field that stores what the user types cannot tell a region
 * from a token, which is why secrets are resolved at use time instead.
 */
const environmentEnvSchema = z.record(
  z
    .string()
    .max(128)
    .regex(/^[A-Z_]\w*$/i, 'Must be a valid environment variable name'),
  z.string().max(4096),
);

export const configurationSchema = z.object({
  bootstrapCommand: z.string().max(8000).optional(),
  env: environmentEnvSchema.optional(),
  excludePaths: z.array(relativePathSchema).max(64).optional(),
  internetAccess: z.boolean().optional(),
  // Which form the product shows. Accepted here so it is stored rather than
  // stripped by the parse; it never travels on to the execution plane. New
  // environments are `code`: a folder of files is a folder on the drive, not
  // an environment. `files` is still accepted because the previous release
  // stored it, and an edit sends the stored configuration back whole — refusing
  // it would leave those environments impossible to change.
  kind: z.enum(['code', 'files']).optional(),
  maintenanceCommand: z.string().max(8000).optional(),
  // One repository per environment. The wire format stays a list because the
  // execution plane checks out an array of sources, but an environment that
  // builds from two repositories has no single working directory to hand a
  // conversation — and the picker that fills this offers exactly one.
  sources: z.array(environmentSourceSchema).max(1).optional(),
});

/**
 * A new environment's configuration: `code` only. {@link configurationSchema}
 * accepts the legacy `files` kind so a stored row can still be edited; nothing
 * creates one any more.
 */
export const newConfigurationSchema = configurationSchema.extend({
  kind: z.literal('code').optional(),
});
