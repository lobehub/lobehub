import { sql } from 'drizzle-orm';

import { messages } from '../schemas';

/**
 * Duplicated transcripts (agent / group copy, workspace import, topic
 * duplicate) carry `metadata.copied`. They keep their own token/cost figures —
 * those describe the generation the transcript records, and the chat UI,
 * subagent chips and the context engine's token accounting all read them.
 *
 * What a copy must NOT do is answer "what did this scope spend": the tokens
 * were consumed by the source, so every scope-level aggregate excludes marked
 * rows.
 *
 * Where the line falls:
 * - CONSUMPTION — spend, tokens, per-model request counts over a user /
 *   workspace / agent / topic. Filter. (usage service, `getTokenHeatmaps`,
 *   `rankModels`, `recomputeTopicUsage`.)
 * - CONTENT — "how much do I have": message counts, word counts, the activity
 *   heatmap, workspace content stats. Do NOT filter; the copy really is part
 *   of what the user now owns.
 * - DISPLAY and CONTEXT-WINDOW math — the per-message token chip, subagent
 *   chips, the context engine's token accounting. Do NOT filter; these read
 *   the figures the copy deliberately kept.
 *
 * NULL-safe by construction: rows with no metadata, or metadata without the
 * key, COALESCE to `''` → kept.
 *
 * The COALESCE is NOT cosmetic. Null-testing a jsonb arrow expression in a
 * WHERE clause crashes `pg_search`'s planner hook on any table carrying a bm25
 * index — SQLSTATE XX000 `rt_fetch used out-of-bounds`, thrown at plan time
 * before any row is read, so no test can catch it. `messages` carries one.
 * See the block comment above `TopicModel` for the mechanism and the incidents
 * that established this rule.
 */
export const notCopiedTranscript = () =>
  sql`coalesce(${messages.metadata} ->> 'copied', '') <> 'true'`;

/**
 * Raw-SQL twin of {@link notCopiedTranscript}, for aggregates assembled as SQL
 * text rather than through the query builder (`recomputeTopicUsage`). Assumes
 * `messages` is the (only) table in scope.
 */
export const NOT_COPIED_TRANSCRIPT_SQL = `COALESCE(metadata ->> 'copied', '') <> 'true'`;

/**
 * Topic-level usage rollups a duplicated topic must not inherit: unlike the
 * per-message figures they are not a transcript fact but a denormalized answer
 * to "what did this topic cost this scope", and a fresh copy has spent
 * nothing. NULL is the column's own "not measured yet" value (see the topic
 * schema), and `recomputeTopicUsage` — which now skips copied rows — converges
 * on exactly this state, so the reset only closes the window before the user
 * first continues the conversation.
 */
export const COPIED_TOPIC_USAGE_RESET = {
  cost: null,
  totalCost: null,
  totalInputTokens: null,
  totalOutputTokens: null,
  totalTokens: null,
  usage: null,
} as const;
