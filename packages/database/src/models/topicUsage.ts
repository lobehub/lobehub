import { and, eq, sql } from 'drizzle-orm';

import { topics } from '../schemas';
import type { Transaction } from '../type';
import { buildWorkspaceWhere } from '../utils/workspace';

/**
 * ModelUsage numeric fields summed per (provider, model) to build the
 * `cost.llm.byModel[].usage` breakdown. Mirrors ModelUsageSchema in
 * `@lobechat/types` (message/common/metadata.ts) — keep in sync if it changes.
 */
const USAGE_FIELDS = [
  'totalInputTokens',
  'totalOutputTokens',
  'totalTokens',
  'inputTextTokens',
  'inputImageTokens',
  'inputAudioTokens',
  'inputVideoTokens',
  'inputCitationTokens',
  'inputToolTokens',
  'inputCachedTokens',
  'inputCacheMissTokens',
  'inputWriteCacheTokens',
  'inputCachedTextTokens',
  'inputCachedImageTokens',
  'inputCachedAudioTokens',
  'inputCachedVideoTokens',
  'outputTextTokens',
  'outputImageTokens',
  'outputAudioTokens',
  'outputReasoningTokens',
  'acceptedPredictionTokens',
  'rejectedPredictionTokens',
] as const;

const num = (v: unknown): number => (v == null ? 0 : Number(v));

/**
 * Recompute a topic's denormalized usage/cost rollup from its assistant messages.
 *
 * Pure derived projection: SUM over the topic's `role='assistant'` messages
 * (thread messages count too — they also carry `topic_id`), preferring the
 * dedicated `usage` column and falling back to legacy `metadata.usage`. The
 * stored shape mirrors `agent_operations`:
 *   - scalar columns : total_input_tokens / total_output_tokens / total_tokens / total_cost
 *   - `usage` jsonb  : flat aggregate { llm: { apiCalls, processingTimeMs, tokens }, tools, humanInteraction }
 *   - `cost`  jsonb  : { total, currency, llm: { total, currency, byModel[] }, tools } — or NULL when no model reported cost
 *   - model/provider : the dominant model by total_tokens
 *
 * Idempotent and non-cumulative: when the topic has no measurable assistant
 * usage (e.g. after deletions), the columns are reset to NULL ("not measured"),
 * so deletes / regenerations are reflected correctly.
 *
 * Keep activity timestamps stable: recency is derived from `messages.updated_at`,
 * so this projection update must not bump `topics.updated_at` / `accessed_at`.
 * Drizzle `$onUpdate` is bypassed by explicitly assigning the columns to
 * themselves.
 *
 * TODO: This still updates the `topics` row for usage/cost/token rollups. Under
 * high-concurrency assistant finalization for the same topic, it can still
 * serialize on the topic row lock. Consider moving this projection to a
 * debounced/asynchronous rollup or a separate per-topic usage table.
 */
export const recomputeTopicUsage = async (
  trx: Transaction,
  userId: string,
  topicId: string,
  workspaceId?: string,
): Promise<void> => {
  // Reads prefer the dedicated `usage` column, falling back to legacy
  // `metadata->'usage'` for rows written before the migration.
  const fieldSelects = USAGE_FIELDS.map(
    (f) => `sum((COALESCE(usage, metadata->'usage')->>'${f}')::numeric) AS "${f}"`,
  ).join(',\n      ');

  // Workspace-aware ownership predicate for the raw messages aggregate: in team
  // mode rows are scoped by workspace_id (creator user_id is not part of the
  // filter); in personal mode by user_id with workspace_id IS NULL.
  const messageOwnership = workspaceId
    ? sql`workspace_id = ${workspaceId}`
    : sql`user_id = ${userId} AND workspace_id IS NULL`;

  const { rows } = await trx.execute(sql`
    SELECT
      provider,
      model,
      count(*)::int AS "msgCount",
      sum((COALESCE(usage, metadata->'usage')->>'cost')::numeric) AS "cost",
      sum((metadata->'performance'->>'duration')::numeric) AS "durationMs",
      ${sql.raw(fieldSelects)}
    FROM messages
    WHERE topic_id = ${topicId}
      AND ${messageOwnership}
      AND role = 'assistant'
      AND (usage IS NOT NULL OR metadata ? 'usage')
    GROUP BY provider, model
  `);

  const groups = rows as Array<Record<string, unknown>>;

  // No measurable usage left → reset to NULL so the column reflects reality.
  if (groups.length === 0) {
    await trx
      .update(topics)
      .set({
        accessedAt: topics.accessedAt,
        cost: null,
        model: null,
        provider: null,
        totalCost: null,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalTokens: null,
        updatedAt: topics.updatedAt,
        usage: null,
      })
      .where(and(eq(topics.id, topicId), buildWorkspaceWhere({ userId, workspaceId }, topics)));
    return;
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let hasCost = false;
  let apiCalls = 0;
  let processingTimeMs = 0;
  const byModel: Array<Record<string, unknown>> = [];
  let primary: { model: string | null; provider: string | null; tokens: number } | null = null;

  for (const g of groups) {
    const rowTotalTokens = num(g.totalTokens);
    totalInputTokens += num(g.totalInputTokens);
    totalOutputTokens += num(g.totalOutputTokens);
    totalTokens += rowTotalTokens;
    apiCalls += num(g.msgCount);
    processingTimeMs += num(g.durationMs);

    const rowCost = g.cost == null ? null : Number(g.cost);
    if (rowCost != null) {
      totalCost += rowCost;
      hasCost = true;
    }

    // Dominant model = largest token volume.
    if (!primary || rowTotalTokens > primary.tokens) {
      primary = {
        model: (g.model as string) ?? null,
        provider: (g.provider as string) ?? null,
        tokens: rowTotalTokens,
      };
    }

    // cost.llm.byModel mirrors the operation shape: cost-bearing models only,
    // each carrying its merged ModelUsage breakdown.
    if (rowCost != null) {
      const usageObj: Record<string, number> = {};
      for (const f of USAGE_FIELDS) if (g[f] != null) usageObj[f] = Number(g[f]);
      usageObj.cost = rowCost;

      byModel.push({
        id: `${(g.provider as string) ?? 'unknown'}/${(g.model as string) ?? 'unknown'}`,
        model: (g.model as string) ?? null,
        provider: (g.provider as string) ?? null,
        totalCost: rowCost,
        usage: usageObj,
      });
    }
  }

  const usage = {
    humanInteraction: {
      approvalRequests: 0,
      promptRequests: 0,
      selectRequests: 0,
      totalWaitingTimeMs: 0,
    },
    llm: {
      apiCalls,
      processingTimeMs,
      tokens: { input: totalInputTokens, output: totalOutputTokens, total: totalTokens },
    },
    // Tool / human-interaction accounting isn't reconstructable from assistant
    // messages alone; left as a zero skeleton to keep the shape aligned with operations.
    tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
  };

  const cost = hasCost
    ? {
        currency: 'USD',
        llm: { byModel, currency: 'USD', total: totalCost },
        total: totalCost,
        tools: { byTool: [], currency: 'USD', total: 0 },
      }
    : null;

  await trx
    .update(topics)
    .set({
      accessedAt: topics.accessedAt,
      cost,
      model: primary?.model ?? null,
      provider: primary?.provider ?? null,
      totalCost: hasCost ? totalCost : null,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      updatedAt: topics.updatedAt,
      usage,
    })
    .where(and(eq(topics.id, topicId), buildWorkspaceWhere({ userId, workspaceId }, topics)));
};
