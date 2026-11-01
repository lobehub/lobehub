import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

import { documents } from '../schemas';

/**
 * `documents.metadata.originalCharCount` as bigint, or NULL when absent or malformed.
 *
 * Document metadata is client-writable (`z.record(z.string(), z.any())`), so a plain `::bigint`
 * cast would raise on a non-numeric value and fail the whole statement — one bad row would break
 * message loading for its topic. Only a JSON number made of 1–18 digits is cast, which also keeps
 * it within bigint range.
 */
export const documentOriginalCharCount = (): SQL<number | null> =>
  sql<number | null>`CASE
    WHEN jsonb_typeof(${documents.metadata} -> 'originalCharCount') = 'number'
      AND (${documents.metadata} ->> 'originalCharCount') ~ '^[0-9]{1,18}$'
    THEN (${documents.metadata} ->> 'originalCharCount')::bigint
  END`;
