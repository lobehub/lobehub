import { z } from 'zod';

/**
 * A heterogeneous agent's configured `env` as clients forward it to device
 * RPCs (quota sampling, model catalogs). Stored configs can carry `null`
 * values, since a deep-merged config patch keeps `null` instead of deleting
 * the key. A `null` entry means "unset", so it is dropped here rather than
 * failing the whole request. A request that failed validation never reached
 * the device, and the quota panel then showed a bare "Quota is unavailable".
 */
export const heterogeneousEnvSchema = z
  .record(z.string(), z.string().nullable())
  .transform((env) =>
    Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== null),
    ),
  );
