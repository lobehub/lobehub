import { LOADING_FLAT } from '@lobechat/const';
import type { ModelReasoning } from '@lobechat/types';
import { sql } from 'drizzle-orm';

import { messages } from '../../schemas';

/**
 * Matches one character outside the exact ECMAScript `String.prototype.trim()`
 * whitespace class (ASCII whitespace + Unicode White_Space / BOM). Passed as a
 * bind parameter so SQL and JS `.trim()` agree on `U+00A0`, `U+202F`,
 * `U+FEFF`, etc. A plain `~` match stops at the first non-blank character,
 * instead of building a whitespace-stripped copy of every reasoning text.
 */
const ECMA_NON_WHITESPACE_PATTERN =
  '[^\\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]';

/**
 * `messages.reasoning` with `content` and protocol replay fields (`signature`,
 * `responseItems`) projected away in SQL so historical reasoning text never
 * leaves PostgreSQL during conversation list reads.
 *
 * Invariant:
 * - In-progress messages (`content = LOADING_FLAT`, or empty `content` with no
 *   `tools` and no `error`) keep their full stored `reasoning` so a mid-stream
 *   page refresh still renders the live thinking card without a round trip.
 * - Settled messages with non-whitespace `reasoning.content` (see `ECMA_NON_WHITESPACE_PATTERN`, matching
 *   JS `.trim()`) return `{ contentOmitted: true, duration?, isMultimodal? }`,
 *   giving collapsed UI cards everything they need ("Thought for X.Xs") and
 *   signaling that full text can be lazy-loaded on expand.
 * - Protocol-only rows (`signature` / `responseItems` without renderable
 *   `content`) return `{ protocolOmitted: true }`: UI cards stay hidden
 *   (`hasRenderableReasoning` is false), while lossless export and browser-mode
 *   rehydration still know to fetch the stored protocol fields.
 */
export const viewModelReasoning = sql<ModelReasoning | null>`CASE
  WHEN ${messages.reasoning} IS NULL
    OR jsonb_typeof(${messages.reasoning}) IS DISTINCT FROM 'object'
    OR ${messages.content} = ${LOADING_FLAT}
    OR (
      (${messages.content} IS NULL OR ${messages.content} = '')
      AND ${messages.tools} IS NULL
      AND ${messages.error} IS NULL
    )
  THEN ${messages.reasoning}
  WHEN jsonb_typeof(${messages.reasoning} -> 'content') = 'string'
    AND (${messages.reasoning} ->> 'content') ~ ${ECMA_NON_WHITESPACE_PATTERN}
  THEN jsonb_strip_nulls(
    jsonb_build_object(
      'contentOmitted', true,
      'duration', ${messages.reasoning} -> 'duration',
      'isMultimodal', ${messages.reasoning} -> 'isMultimodal'
    )
  )
  WHEN (
      jsonb_typeof(${messages.reasoning} -> 'signature') = 'string'
      AND (${messages.reasoning} ->> 'signature') <> ''
    )
    OR (
      jsonb_typeof(${messages.reasoning} -> 'responseItems') = 'array'
      AND jsonb_array_length(${messages.reasoning} -> 'responseItems') > 0
    )
  THEN jsonb_build_object('protocolOmitted', true)
  ELSE NULL
END`;
